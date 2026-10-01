/**
 * eSSL / ZKTeco "ADMS" (PUSH / iclock) endpoint, served by the app itself on Vercel.
 *
 * The device's Cloud Server = the app's domain, port 443. It then:
 *   GET  /iclock/cdata?SN=..&options=all   handshake, we answer with push options
 *   GET  /iclock/getrequest?SN=..          polls for queued commands (C:<no>:<command>)
 *   POST /iclock/devicecmd?SN=..           reports each command's Return code
 *   POST /iclock/cdata?SN=..&table=ATTLOG  punches (attendance)
 *   POST /iclock/cdata?SN=..&table=OPERLOG user / fingerprint changes (FP, OPLOG 6)
 *   POST /iclock/cdata?SN=..&table=BIODATA fingerprint templates on newer firmware
 *
 * Only devices registered in /biometricDevices with integrationType "adms" and a matching
 * serial number are served. An uploaded fingerprint template is (1) proof that the member's
 * first thumb was enrolled and (2) kept in /biometricTemplates (server-only), so the door lock
 * can restore a renewed member without a new scan.
 *
 * Door lock without database triggers: the app queues a "door_check" (plan or block changed) or
 * "forget" (member deleted) note in /biometricCommands; the device's next poll handles it. The
 * first poll after midnight re-checks everyone, so plans that end at midnight close the door.
 */
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from "firebase-admin/firestore";
import { db, localDate, text } from "./admin";
import { systemAudit } from "./audit";
import {
  importDeviceData,
  importWindowOpen,
  matchPending,
  type MachineUser,
} from "./device-import";

/** Device clocks are set to gym local time (Asia/Kolkata). */
const TZ_OFFSET = "+05:30";
/** Punches older than this are skipped, so a first connection does not import years of history. */
const MAX_LOG_AGE_DAYS = 7;
/** An enrollment request the device never picked up is not replayed later at a random moment. */
const ENROLL_REQUEST_TTL_MS = 10 * 60 * 1000;
/** Seconds between device polls. Each poll costs ~1 Firestore read (free plan: 50,000/day). */
const POLL_DELAY_SECONDS = 15;
/** App-side notes handled here on the server, never sent to a device. */
const SERVER_TASKS = new Set(["door_check", "forget", "bin_off", "staff_off", "photo_sync"]);
/** Machine requests that expire if the machine doesn't pick them up in time. */
const STALE_WHEN_LATE = new Set(["user_upsert", "import_check", "import_users", "import_fp"]);
const STALE_AFTER_MS = 30 * 60 * 1000;

type Device = {
  id: string;
  name: string;
  serialNumber: string;
  lastDoorSyncDate: string;
  pendingMatches: boolean;
  /** Punches up to this time (ms) are saved; re-sent older days are skipped without reads. */
  attSeenUntil: number;
};
type KV = Record<string, string>;
type Row = Record<string, unknown>;

// Warm-instance caches: a polling device costs about one device read per minute.
const deviceCache = new Map<string, { device: Device | null; at: number }>();
const bulkLogAt = new Map<string, number>();
const lastSeenWrite = new Map<string, number>();

async function findDevice(sn: string): Promise<Device | null> {
  const cached = deviceCache.get(sn);
  // 3 minutes: a polling machine then costs ~480 reads a day (settings are re-read where they
  // matter, e.g. door control when a lock-out is decided).
  if (cached && Date.now() - cached.at < 180_000) return cached.device;
  const snap = await db().collection("biometricDevices").where("serialNumber", "==", sn).get();
  const match = snap.docs.find(
    (d) => d.data()["integrationType"] === "adms" && d.data()["status"] !== "disabled",
  );
  const device = match
    ? {
        id: match.id,
        name: String(match.data()["name"] ?? "Device"),
        serialNumber: sn,
        lastDoorSyncDate: String(match.data()["lastDoorSyncDate"] ?? ""),
        pendingMatches: match.data()["pendingMatches"] === true,
        attSeenUntil: Number(match.data()["attSeenUntil"] ?? 0) || 0,
      }
    : null;
  deviceCache.set(sn, { device, at: Date.now() });
  return device;
}

async function touchDevice(device: Device, ip: string) {
  const last = lastSeenWrite.get(device.id) ?? 0;
  if (Date.now() - last < 120_000) return;
  lastSeenWrite.set(device.id, Date.now());
  await db()
    .doc(`biometricDevices/${device.id}`)
    .update({ lastSeenAt: FieldValue.serverTimestamp(), lastIp: ip });
}

/** "FP PIN=1\tFID=5\tValid=1" → { PIN: "1", FID: "5", Valid: "1" } (keys upper-cased). */
function parseKv(line: string): KV {
  const out: KV = {};
  line
    .replace(/^\S+\s+/, "")
    .split("\t")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim().toUpperCase()] = part.slice(i + 1).trim();
    });
  return out;
}

/** A staff member registered with this ID on this device (staff IDs start at 9001). */
async function staffForPin(pin: string, device: Device) {
  const snap = await db().collection("staff").where("biometricUserId", "==", pin).get();
  return (
    snap.docs.find((d) => d.data()["biometricDeviceId"] === device.id) ??
    snap.docs.find((d) => !d.data()["biometricDeviceId"]) ??
    null
  );
}

async function clientForPin(pin: string, device: Device) {
  const snap = await db().collection("clients").where("biometricUserId", "==", pin).get();
  return (
    snap.docs.find((d) => d.data()["biometricDeviceId"] === device.id) ??
    snap.docs.find((d) => !d.data()["biometricDeviceId"]) ??
    null
  );
}

// ---------------------------------------------------------------- handshake

function handshake(sn: string, fullUpload = false) {
  return [
    `GET OPTION FROM: ${sn}`,
    "ATTLOGStamp=None",
    // None = send every user and fingerprint again (only right after "Read users").
    `OPERLOGStamp=${fullUpload ? "None" : "9999"}`,
    "ATTPHOTOStamp=None",
    "ErrorDelay=30",
    `Delay=${POLL_DELAY_SECONDS}`,
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP",
    "Realtime=1",
    "Encrypt=None",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- commands

const createdMs = (d: Row) =>
  (d["createdAt"] as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

/** Marks a server task as taken, so two polls at once never run it twice. */
async function claim(ref: DocumentReference) {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.data()?.["status"] !== "pending") return false;
    tx.update(ref, {
      status: "sent",
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

async function runServerTasks(tasks: QueryDocumentSnapshot[]) {
  for (const t of tasks) {
    if (!(await claim(t.ref))) continue;
    const d = t.data();
    let error = "";
    try {
      if (d["type"] === "staff_off")
        await removeStaffFromDevice(
          String(d["staffId"] ?? ""),
          String(d["biometricUserId"] ?? ""),
          String(d["deviceId"] ?? ""),
        );
      else if (d["type"] === "forget")
        await forgetDeletedMember(
          String(d["clientId"]),
          String(d["biometricUserId"] ?? ""),
          String(d["deviceId"] ?? ""),
        );
      else if (d["type"] === "bin_off")
        await removeFromDevice(
          String(d["clientId"]),
          String(d["biometricUserId"] ?? ""),
          String(d["deviceId"] ?? ""),
        );
      else if (d["type"] === "photo_sync") await queueMemberPhoto(String(d["clientId"]));
      else await syncDoorAccess(String(d["clientId"]));
    } catch (e) {
      error = String(e);
      console.error("door task failed", t.id, error);
    }
    await t.ref.update({
      status: error ? "failed" : "done",
      error,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

/** Once per day (first poll after midnight): plans that ended yesterday close the door. */
async function dailySync(device: Device) {
  const today = localDate();
  if (device.lastDoorSyncDate === today) return;
  const ref = db().doc(`biometricDevices/${device.id}`);
  const mine = await db().runTransaction(async (tx) => {
    if ((await tx.get(ref)).data()?.["lastDoorSyncDate"] === today) return false;
    tx.update(ref, { lastDoorSyncDate: today });
    return true;
  });
  device.lastDoorSyncDate = today;
  if (mine) {
    const changed = await syncAllDoorAccess(today);
    console.info("Daily door access sync", { device: device.id, changed });
  }
}

async function nextCommands(device: Device) {
  const firestore = db();
  await dailySync(device);
  // Capped, so a pile of app notes (e.g. after importing members) never makes each poll read
  // and work through hundreds of them: they are done a few at a time, polls stay fast.
  const pending = await firestore
    .collection("biometricCommands")
    .where("status", "==", "pending")
    .limit(100)
    .get();
  const tasks = pending.docs.filter((d) => SERVER_TASKS.has(String(d.data()["type"])));
  if (tasks.length) await runServerTasks(tasks.slice(0, 25));
  // What those tasks decided (e.g. "take this member off the machine") goes out in this same
  // check-in, not the next one: Block entry reaches the door one poll (~15 s) sooner.
  const queue = tasks.length
    ? await firestore
        .collection("biometricCommands")
        .where("status", "==", "pending")
        .limit(100)
        .get()
    : pending;
  // Users uploaded faster than they could be linked: link some more on each check-in.
  if (device.pendingMatches) {
    const left = await matchPending(device).catch(() => 1);
    if (left === 0) device.pendingMatches = false;
  }
  // "Read users" pressed several times: the machine is asked once (repeats are withdrawn).
  const asked = new Set<string>();
  const repeats = queue.docs.filter((d) => {
    const x = d.data();
    if (x["deviceId"] !== device.id || !String(x["type"]).startsWith("import_")) return false;
    const key = String(x["command"]);
    if (asked.has(key)) return true;
    asked.add(key);
    return false;
  });
  if (repeats.length) {
    const b = firestore.batch();
    repeats.forEach((d) =>
      b.update(d.ref, { status: "cancelled", updatedAt: FieldValue.serverTimestamp() }),
    );
    await b.commit();
  }
  const withdrawn = new Set(repeats.map((d) => d.id));
  const mine = queue.docs
    .filter(
      (d) =>
        d.data()["deviceId"] === device.id &&
        !SERVER_TASKS.has(String(d.data()["type"])) &&
        !withdrawn.has(d.id),
    )
    .sort(
      (a, b) =>
        createdMs(a.data()) - createdMs(b.data()) ||
        Number(a.data()["order"] ?? 0) - Number(b.data()["order"] ?? 0),
    )
    .slice(0, 5);
  if (!mine.length) return [];
  const deviceRef = firestore.doc(`biometricDevices/${device.id}`);
  return firestore.runTransaction(async (tx) => {
    const [deviceSnap, ...fresh] = await Promise.all([
      tx.get(deviceRef),
      ...mine.map((m) => tx.get(m.ref)),
    ]);
    const now = Date.now();
    const lines: string[] = [];
    let seq = Number(deviceSnap.data()?.["cmdSeq"] ?? 0);
    for (const cmd of fresh) {
      const d = cmd.data();
      if (!d || d["status"] !== "pending") continue;
      const created = createdMs(d) || now;
      if (d["type"] === "enroll_fp" && now - created > ENROLL_REQUEST_TTL_MS) {
        tx.update(cmd.ref, {
          status: "failed",
          error: "The device did not connect in time. Check it is online, then press Try again.",
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        continue;
      }
      // Registration and "Read users" only make sense while someone is at the machine: after
      // the machine was off for a while they are dropped, not run by surprise. Door lock-outs
      // and put-backs (door: true) always go through.
      if (
        d["door"] !== true &&
        STALE_WHEN_LATE.has(String(d["type"])) &&
        now - created > STALE_AFTER_MS
      ) {
        tx.update(cmd.ref, {
          status: "failed",
          error: "Not sent: the machine was off. Press Try again.",
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        continue;
      }
      seq += 1;
      lines.push(`C:${seq}:${String(d["command"])}`);
      tx.update(cmd.ref, {
        status: "sent",
        cmdNo: seq,
        sentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.update(deviceRef, { cmdSeq: seq });
    return lines;
  });
}

const RETURN_MESSAGES: Record<string, string> = {
  "-1": "The device rejected the request. Check the member's biometric ID.",
  "-2": "The device could not save the member. Its memory may be full.",
  "-3": "The device is busy. Press Try again.",
};

async function commandResults(device: Device, body: string) {
  const firestore = db();
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const params = new URLSearchParams(line);
    const cmdNo = Number(params.get("ID"));
    const code = Number(params.get("Return") ?? "0");
    if (!Number.isFinite(cmdNo)) continue;
    const snap = await firestore
      .collection("biometricCommands")
      .where("deviceId", "==", device.id)
      .where("cmdNo", "==", cmdNo)
      .limit(1)
      .get();
    const cmd = snap.docs[0];
    if (!cmd) continue;
    const d = cmd.data();
    const ok = code === 0;
    // Older push firmware takes ENROLL_FP, newer takes ENROLL_BIO. If the machine says it doesn't
    // understand the first, ask once more in the other form: the member just presses again.
    if (!ok && d["type"] === "enroll_fp" && [-1, -1001, -1002].includes(code) && !d["fallback"]) {
      await cmd.ref.update({
        status: "failed",
        returnCode: code,
        error: "Trying the machine's other fingerprint command…",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const pin = String(d["biometricUserId"] ?? "");
      await firestore.collection("biometricCommands").add({
        deviceId: device.id,
        serialNumber: device.serialNumber,
        clientId: d["clientId"] ?? "",
        staffId: d["staffId"] ?? "",
        enrollmentId: d["enrollmentId"] ?? null,
        biometricUserId: pin,
        type: "enroll_fp",
        fallback: true,
        door: false,
        command: `ENROLL_BIO TYPE=1\tPIN=${pin}\tRETRY=3\tOVERWRITE=1`,
        order: 2,
        status: "pending",
        cmdNo: null,
        returnCode: null,
        error: "",
        sentAt: null,
        completedAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      continue;
    }
    const error = ok
      ? ""
      : d["type"] === "enroll_fp"
        ? `Thumb not captured (device code ${code}). Ask the member to place the thumb firmly 3 times, then press Try again.`
        : (RETURN_MESSAGES[String(code)] ?? `Device returned code ${code}.`);
    await cmd.ref.update({
      status: ok ? "done" : "failed",
      returnCode: code,
      error,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // The machine answered the request for a thumb copy: a Block entry waiting for it goes on
    // now (even when no thumb came), instead of at the next day's check.
    if (d["type"] === "query_fp" && d["clientId"])
      await syncDoorAccess(String(d["clientId"])).catch((e) =>
        console.error("door check after thumb copy failed", String(e)),
      );
    if (!ok && d["enrollmentId"])
      await firestore
        .doc(`enrollments/${String(d["enrollmentId"])}`)
        .update({ lastError: error, updatedAt: FieldValue.serverTimestamp() })
        .catch(() => undefined);
    // Some firmware only confirms the capture through the Return code. Ask the device to upload
    // the new template so activation still happens only on proof from the device.
    if (ok && d["type"] === "enroll_fp")
      await firestore.collection("biometricCommands").add({
        deviceId: device.id,
        serialNumber: device.serialNumber,
        clientId: d["clientId"] ?? "",
        staffId: d["staffId"] ?? "",
        enrollmentId: d["enrollmentId"] ?? null,
        biometricUserId: d["biometricUserId"] ?? "",
        type: "query_fp",
        command: `DATA QUERY FINGERTMP PIN=${String(d["biometricUserId"])}`,
        order: 3,
        status: "pending",
        cmdNo: null,
        returnCode: null,
        error: "",
        sentAt: null,
        completedAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
  }
}

// ---------------------------------------------------------------- fingerprint proof → activation

/**
 * Called only when the device itself reports a fingerprint for this PIN. Activates the member:
 * biometric active, first thumb registered, pending membership / PT started, enrollment done.
 */
async function activateBiometric(clientRef: DocumentReference, device: Device, pin: string) {
  const firestore = db();
  const today = localDate();
  const activated = await firestore.runTransaction(async (tx) => {
    const client = await tx.get(clientRef);
    if (!client.exists) return null;
    const c = client.data() ?? {};
    // Already registered: a thumb sent now is the copy the door lock asked for (e.g. after Block
    // entry), not a new registration. It must never switch a staff block back to "can enter".
    if (c["firstThumbRegistered"] === true && c["biometricStatus"] !== "not_enrolled") return null;
    const [enrollments, memberships, ptList] = await Promise.all([
      tx.get(firestore.collection("enrollments").where("clientId", "==", client.id)),
      tx.get(firestore.collection("memberships").where("clientId", "==", client.id)),
      tx.get(firestore.collection("ptAssignments").where("clientId", "==", client.id)),
    ]);
    const pts = ptList.docs;
    const now = FieldValue.serverTimestamp();
    const clientPatch: Row = {
      biometricUserId: pin,
      biometricDeviceId: device.id,
      // Blocked by staff stays blocked, even while a thumb is being registered.
      biometricStatus: c["biometricStatus"] === "disabled" ? "disabled" : "active",
      firstThumbRegistered: true,
      status: "active",
      updatedAt: now,
    };
    const byId = new Map(memberships.docs.map((m) => [m.id, m]));
    for (const e of enrollments.docs.filter((x) => x.data()["status"] === "biometric_pending")) {
      const ed = e.data();
      const m = ed["membershipId"] ? byId.get(String(ed["membershipId"])) : undefined;
      if (m && m.data()["status"] === "biometric_pending") {
        const md = m.data();
        const status = String(md["startDate"] ?? today) > today ? "pending" : "active";
        if (status === "active") {
          memberships.docs
            .filter((o) => o.id !== m.id && o.data()["status"] === "active")
            .forEach((o) => tx.update(o.ref, { status: "expired", updatedAt: now }));
          clientPatch["currentMembership"] = {
            membershipId: m.id,
            packageName: md["packageNameSnapshot"] ?? "",
            startDate: md["startDate"] ?? "",
            endDate: md["endDate"] ?? "",
            status,
          };
        }
        tx.update(m.ref, { status, updatedAt: now });
      }
      // PT runs from its own start date; only a PT still waiting for the thumb starts here.
      const ptSnap = ed["ptAssignmentId"]
        ? pts.find((x) => x.id === String(ed["ptAssignmentId"]))
        : undefined;
      if (
        ptSnap?.data()?.["status"] === "pending" &&
        String(ptSnap.data()?.["startDate"] ?? "") <= today
      )
        tx.update(ptSnap.ref, { status: "active", updatedAt: now });
      tx.update(e.ref, {
        status: "active",
        biometricDeviceId: device.id,
        biometricUserId: pin,
        firstThumbRegistered: true,
        lastError: "",
        updatedAt: now,
      });
    }
    tx.update(clientRef, clientPatch);
    return String(c["fullName"] ?? "");
  });
  if (activated === null) return;
  await systemAudit({
    collection: "clients",
    docId: clientRef.id,
    clientId: clientRef.id,
    clientName: activated,
    summary: `Thumb registered on the device (${device.name}, ID ${pin})`,
  });
  const open = await firestore
    .collection("biometricCommands")
    .where("clientId", "==", clientRef.id)
    .get();
  await Promise.all(
    open.docs
      .filter(
        (d) =>
          ["enroll_fp", "user_upsert"].includes(String(d.data()["type"])) &&
          !d.data()["door"] &&
          ["pending", "sent"].includes(String(d.data()["status"])),
      )
      .map((d) =>
        d.ref.update({
          status: "done",
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }),
      ),
  );
  // Like the old software: the machine shows the member's photo with the name after a punch.
  await queueMemberPhoto(clientRef.id);
}

/** Cloudinary serves a small portrait JPEG just by changing the link (no image tools here). */
const devicePhotoUrl = (url: string) =>
  /^https:\/\/res\.cloudinary\.com\/[^/\s]+\/image\/upload\//.test(url)
    ? url.replace("/image/upload/", "/image/upload/c_fill,g_face,w_240,h_320,q_60,f_jpg/")
    : "";

/**
 * Sends the member's photo to the machine they are on (shown after each punch). Only for a
 * member whose thumb is on the machine; a missing photo or a slow image host never blocks
 * anything, the photo is simply not sent.
 */
export async function queueMemberPhoto(clientId: string) {
  try {
    const firestore = db();
    const c = (await firestore.doc(`clients/${clientId}`).get()).data();
    const pin = String(c?.["biometricUserId"] ?? "");
    const deviceId = String(c?.["biometricDeviceId"] ?? "");
    const src = devicePhotoUrl(String(c?.["profilePhotoUrl"] ?? ""));
    if (!c || !pin || !deviceId || !src) return false;
    if (c["firstThumbRegistered"] !== true || c["deviceAccess"] === "removed") return false;
    const device = (await firestore.doc(`biometricDevices/${deviceId}`).get()).data();
    // Off unless the owner switched it on: the machine normally takes its own photo.
    if (!device || device["integrationType"] !== "adms" || device["sendPhotos"] !== true)
      return false;
    const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const photo = Buffer.from(await res.arrayBuffer()).toString("base64");
    // A 240x320 JPEG is about 15 KB; anything far bigger is not a photo the machine wants.
    if (!photo || photo.length > 60_000) return false;
    await firestore.collection("biometricCommands").add({
      deviceId,
      serialNumber: String(device["serialNumber"] ?? ""),
      clientId,
      enrollmentId: null,
      biometricUserId: pin,
      door: false,
      type: "user_photo",
      order: 90,
      // Size = length of the base64 text (as the machine reports its own photos).
      command: `DATA UPDATE USERPIC PIN=${pin}\tSize=${photo.length}\tContent=${photo}`,
      status: "pending",
      cmdNo: null,
      returnCode: null,
      error: "",
      sentAt: null,
      completedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error("member photo not sent to the machine", clientId, String(e));
    return false;
  }
}

/**
 * PINs the device reports as having a fingerprint. "enrolled" = the device logged a new
 * enrollment (OPLOG 6); "template" = a stored template was uploaded.
 */
function fingerprintEvidence(body: string) {
  const found = new Map<string, "enrolled" | "template">();
  const add = (pin: string | undefined, kind: "enrolled" | "template") => {
    if (pin && found.get(pin) !== "enrolled") found.set(pin, kind);
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(FP|FINGERTMP)\s/i.test(line)) {
      const kv = parseKv(line);
      if (kv["VALID"] !== "0") add(kv["PIN"], "template");
    } else if (/^BIODATA\s/i.test(line)) {
      const kv = parseKv(line);
      if ((kv["TYPE"] ?? "1") === "1" && kv["VALID"] !== "0") add(kv["PIN"], "template");
    } else if (/^OPLOG\s/i.test(line)) {
      // OPLOG <op>\t<admin>\t<time>\t<pin>\t<finger>... ; op 6 = fingerprint enrolled.
      const parts = line.replace(/^OPLOG\s+/i, "").split("\t");
      if (parts[0] === "6") add(parts[3]?.trim(), "enrolled");
    }
  }
  return found;
}

/** Fingerprint template lines, keyed per finger, in the device's own upload format. */
function fingerprintTemplates(body: string) {
  const out: { pin: string; key: string; format: "FP" | "BIODATA"; fields: KV }[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(FP|FINGERTMP)\s/i.test(line)) {
      const kv = parseKv(line);
      if (kv["PIN"] && kv["TMP"] && kv["VALID"] !== "0")
        out.push({ pin: kv["PIN"], key: `fp_${kv["FID"] ?? "0"}`, format: "FP", fields: kv });
    } else if (/^BIODATA\s/i.test(line)) {
      const kv = parseKv(line);
      if (kv["PIN"] && kv["TMP"] && (kv["TYPE"] ?? "1") === "1" && kv["VALID"] !== "0")
        out.push({
          pin: kv["PIN"],
          key: `bio_${kv["NO"] ?? "0"}_${kv["INDEX"] ?? "0"}`,
          format: "BIODATA",
          fields: kv,
        });
    }
  }
  return out;
}

/** User records the machine uploads ("USER PIN=1 Name=Ravi Pri=0…", any letter case). */
function machineUsers(body: string): MachineUser[] {
  const out: MachineUser[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^USER\s/i.test(line)) continue;
    const kv = parseKv(line);
    const pin = (kv["PIN"] ?? "").trim();
    if (!/^[A-Za-z0-9]{1,24}$/.test(pin)) continue;
    out.push({
      pin,
      name: (kv["NAME"] ?? "").trim(),
      privilege: kv["PRI"] ?? kv["PRIVILEGE"] ?? "0",
    });
  }
  return out;
}

/**
 * Each machine user's own settings as the machine keeps them (access group, time slots, verify
 * mode, validity dates…; never the password), on their "Users on this machine" record. Shows how
 * the old software kept people out, and what the machine itself still blocks.
 */
async function keepMachineFields(device: Device, body: string) {
  const writer = db().bulkWriter();
  writer.onWriteError(() => false); // someone not in the list yet: nothing to add to
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^USER\s/i.test(line)) continue;
    const { PASSWD: _p, PASSWORD: _q, ...fields } = parseKv(line);
    const pin = (fields["PIN"] ?? "").trim();
    if (!/^[A-Za-z0-9]{1,24}$/.test(pin)) continue;
    void writer
      .update(db().doc(`deviceUsers/${device.id}_${pin.replace(/[^a-zA-Z0-9_-]/g, "_")}`), {
        machineFields: fields,
        machineFieldsAt: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined);
  }
  await writer.close();
}

/** Device command that puts a stored template back on the device. */
function restoreCommand(pin: string, t: { format: "FP" | "BIODATA"; fields: KV }) {
  const f = t.fields;
  return t.format === "FP"
    ? `DATA UPDATE FINGERTMP PIN=${pin}\tFID=${f["FID"] ?? "0"}\tSize=${f["SIZE"] ?? String((f["TMP"] ?? "").length)}\tValid=1\tTMP=${f["TMP"] ?? ""}`
    : `DATA UPDATE BIODATA Pin=${pin}\tNo=${f["NO"] ?? "0"}\tIndex=${f["INDEX"] ?? "0"}\tValid=1\tDuress=0\tType=1\tMajorVer=${f["MAJORVER"] ?? "0"}\tMinorVer=${f["MINORVER"] ?? "0"}\tFormat=${f["FORMAT"] ?? "0"}\tTmp=${f["TMP"] ?? ""}`;
}

/** Same user record the web app sends when registering a thumb. */
function userInfoCommand(pin: string, name: string) {
  const clean =
    name
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24) || "Member";
  return `DATA UPDATE USERINFO PIN=${pin}\tName=${clean}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0`;
}

/** Keeps a copy of each enrolled finger so a renewed member can be restored without a new scan. */
async function storeTemplates(body: string, device: Device) {
  const firestore = db();
  const saved = new Set<string>();
  for (const t of fingerprintTemplates(body)) {
    const client = await clientForPin(t.pin, device);
    if (!client) continue;
    // Only while staff are registering this member: a spoofed upload can't swap a saved thumb.
    if (!(await hasLiveEnrollRequest(client.id))) continue;
    await firestore.doc(`biometricTemplates/${client.id}`).set(
      {
        clientId: client.id,
        deviceId: device.id,
        pin: t.pin,
        fingers: { [t.key]: { format: t.format, fields: t.fields } },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    saved.add(client.id);
  }
  // A lock-out that waited for this fingerprint to be saved can go ahead now.
  for (const id of saved) await syncDoorAccess(id);
}

// ---------------------------------------------------------------- door lock

const covers = (d: Row, statuses: string[], today: string) =>
  statuses.includes(String(d["status"])) &&
  String(d["startDate"] ?? "") <= today &&
  String(d["endDate"] ?? "") >= today;

/** Entry allowed today: thumb registered, not blocked by staff, and a plan (gym or PT) covers today. */
function entitled(c: Row, plans: Row[], pts: Row[], today: string) {
  if (c["firstThumbRegistered"] !== true || c["biometricStatus"] !== "active") return false;
  return (
    plans.some((m) => covers(m, ["active", "pending"], today)) ||
    pts.some((p) => covers(p, ["active"], today))
  );
}

/**
 * Brings the device in line with the member's entitlement. Returns what changed:
 * "removed" (door closed for them), "restored" (user + thumb pushed back),
 * "needs_thumb" (entitled again but no stored template: staff must register the thumb),
 * "flipped" (an unsent opposite command was withdrawn) or "none".
 */
async function applyDoorAccess(clientId: string, c: Row, allowed: boolean) {
  const firestore = db();
  const ref = firestore.doc(`clients/${clientId}`);
  const pin = String(c["biometricUserId"] ?? "");
  const deviceId = String(c["biometricDeviceId"] ?? "");
  if (c["firstThumbRegistered"] !== true || !pin || !deviceId) return "none";
  const onDevice = c["deviceAccess"] !== "removed";
  if (allowed === onDevice) return "none";
  const device = (await firestore.doc(`biometricDevices/${deviceId}`).get()).data();
  if (!device || device["integrationType"] !== "adms") return "none";
  // "Attendance only": an ended plan doesn't lock anyone out until the owner switches door
  // control on. A staff "Block entry" (and putting a member back) still works.
  if (device["doorControl"] !== true && !allowed && c["biometricStatus"] !== "disabled")
    return "none";

  const now = FieldValue.serverTimestamp();
  const cmds = await firestore
    .collection("biometricCommands")
    .where("clientId", "==", clientId)
    .get();
  const unsent = cmds.docs.filter(
    (d) =>
      d.data()["door"] === true &&
      d.data()["status"] === "pending" &&
      !SERVER_TASKS.has(String(d.data()["type"])),
  );
  if (unsent.length) {
    // The device never ran the last change, so it is still in the state we now want.
    const batch = firestore.batch();
    unsent.forEach((d) => batch.update(d.ref, { status: "cancelled", updatedAt: now }));
    batch.update(ref, { deviceAccess: allowed ? "on" : "removed", deviceAccessChangedAt: now });
    await batch.commit();
    return "flipped";
  }

  const base = {
    deviceId,
    serialNumber: String(device["serialNumber"] ?? ""),
    clientId,
    enrollmentId: null,
    biometricUserId: pin,
    status: "pending",
    door: true,
    cmdNo: null,
    returnCode: null,
    error: "",
    sentAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const batch = firestore.batch();
  const add = (type: string, order: number, command: string) =>
    batch.set(firestore.collection("biometricCommands").doc(), { ...base, type, order, command });
  const name = String(c["fullName"] ?? "");
  const log = (summary: string) =>
    systemAudit({ collection: "clients", docId: clientId, clientId, clientName: name, summary });

  if (!allowed) {
    // Take nobody off the machine before their fingerprint is saved here, so a renewal can put
    // them back without a new scan: ask the machine for it first; the lock-out follows as soon as
    // it arrives (storeTemplates). But when staff pressed Block entry and the machine answered
    // without sending it (some machines can't), the block goes ahead anyway: keeping the door
    // shut matters more, and Allow entry then asks for a new scan.
    const saved = (await firestore.doc(`biometricTemplates/${clientId}`).get()).data();
    if (!Object.keys((saved?.["fingers"] ?? {}) as object).length) {
      const since = Date.now() - 2 * ENROLL_REQUEST_TTL_MS;
      const asked = cmds.docs.filter(
        (d) => d.data()["type"] === "query_fp" && createdMs(d.data()) > since,
      );
      const waiting = asked.some((d) => ["pending", "sent"].includes(String(d.data()["status"])));
      const answered = asked.some((d) => ["done", "failed"].includes(String(d.data()["status"])));
      const blockedByStaff = c["biometricStatus"] === "disabled";
      if (!(blockedByStaff && answered && !waiting)) {
        if (!asked.length)
          // Not a door change: just a request for the fingerprint.
          await firestore.collection("biometricCommands").add({
            ...base,
            door: false,
            type: "query_fp",
            order: 1,
            command: `DATA QUERY FINGERTMP PIN=${pin}`,
          });
        return "none";
      }
    }
    const noCopy = !Object.keys((saved?.["fingers"] ?? {}) as object).length;
    batch.set(firestore.collection("biometricCommands").doc(), {
      ...base,
      type: "delete_user",
      order: 1,
      command: `DATA DELETE USERINFO PIN=${pin}`,
      // Blocked without a saved thumb: Allow entry will need a new scan.
      ...(noCopy ? { noThumbCopy: true } : {}),
    });
    batch.update(ref, { deviceAccess: "removed", deviceAccessChangedAt: now });
    await batch.commit();
    await log("Removed from the door device (no running plan, or entry blocked)");
    return "removed";
  }

  const tpl = await firestore.doc(`biometricTemplates/${clientId}`).get();
  const fingers = Object.values(
    (tpl.data()?.["fingers"] ?? {}) as Record<string, { format: "FP" | "BIODATA"; fields: KV }>,
  );
  add("user_upsert", 1, userInfoCommand(pin, name));
  if (!fingers.length) {
    // No stored thumb to restore: the member must scan again at the counter.
    batch.update(ref, {
      deviceAccess: "on",
      deviceAccessChangedAt: now,
      firstThumbRegistered: false,
      biometricStatus: "not_enrolled",
      enrollmentId: null,
      updatedAt: now,
    });
    await batch.commit();
    await log("Added back to the door device: thumb must be registered again");
    return "needs_thumb";
  }
  fingers.forEach((t, i) => add("restore_fp", 2 + i, restoreCommand(pin, t)));
  batch.update(ref, { deviceAccess: "on", deviceAccessChangedAt: now });
  await batch.commit();
  await log("Added back to the door device with the saved thumb");
  await queueMemberPhoto(clientId);
  return "restored";
}

/** One member, after the app changed a plan or blocked / allowed entry. */
export async function syncDoorAccess(clientId: string, today = localDate()) {
  const firestore = db();
  const c = (await firestore.doc(`clients/${clientId}`).get()).data();
  if (!c || c["firstThumbRegistered"] !== true) return "none";
  const [ms, pts] = await Promise.all([
    firestore.collection("memberships").where("clientId", "==", clientId).get(),
    firestore.collection("ptAssignments").where("clientId", "==", clientId).get(),
  ]);
  const allowed = entitled(
    c,
    ms.docs.map((d) => d.data()),
    pts.docs.map((d) => d.data()),
    today,
  );
  return applyDoorAccess(clientId, c, allowed);
}

/** Everyone with a registered thumb, reading each collection once (free-plan friendly). */
export async function syncAllDoorAccess(today = localDate()) {
  const firestore = db();
  const [clients, plans, pts] = await Promise.all([
    firestore.collection("clients").where("firstThumbRegistered", "==", true).get(),
    firestore.collection("memberships").where("status", "in", ["active", "pending"]).get(),
    firestore.collection("ptAssignments").where("status", "==", "active").get(),
  ]);
  const group = (docs: QueryDocumentSnapshot[]) => {
    const m = new Map<string, Row[]>();
    docs.forEach((d) => {
      const k = String(d.data()["clientId"] ?? "");
      m.set(k, [...(m.get(k) ?? []), d.data()]);
    });
    return m;
  };
  const byPlan = group(plans.docs);
  const byPt = group(pts.docs);
  let changed = 0;
  for (const c of clients.docs) {
    const allowed = entitled(c.data(), byPlan.get(c.id) ?? [], byPt.get(c.id) ?? [], today);
    if ((await applyDoorAccess(c.id, c.data(), allowed)) !== "none") changed += 1;
  }
  return changed;
}

/** The device proved a staff member's thumb while the owner was registering it. */
async function activateStaff(staffRef: DocumentReference, device: Device, pin: string) {
  const snap = await staffRef.get();
  if (!snap.exists || snap.data()?.["firstThumbRegistered"] === true) return;
  const now = FieldValue.serverTimestamp();
  await staffRef.update({
    firstThumbRegistered: true,
    biometricUserId: pin,
    biometricDeviceId: device.id,
    updatedAt: now,
  });
  const open = await db().collection("biometricCommands").where("staffId", "==", staffRef.id).get();
  await Promise.all(
    open.docs
      .filter(
        (d) =>
          ["pending", "sent"].includes(String(d.data()["status"])) &&
          ["enroll_fp", "user_upsert", "query_fp"].includes(String(d.data()["type"])),
      )
      .map((d) => d.ref.update({ status: "done", completedAt: now, updatedAt: now })),
  );
  await systemAudit({
    collection: "staff",
    docId: staffRef.id,
    summary: `Staff thumb registered: ${String(snap.data()?.["name"] ?? "")} (${device.name}, ID ${pin})`,
  });
}

/** Staff member who left: taken off the device; a new thumb is needed if they come back. */
async function removeStaffFromDevice(staffId: string, pin: string, deviceId: string) {
  const firestore = db();
  const device = deviceId
    ? (await firestore.doc(`biometricDevices/${deviceId}`).get()).data()
    : null;
  const now = FieldValue.serverTimestamp();
  if (pin && device?.["integrationType"] === "adms")
    await firestore.collection("biometricCommands").add({
      deviceId,
      serialNumber: String(device["serialNumber"] ?? ""),
      clientId: "",
      staffId,
      enrollmentId: null,
      biometricUserId: pin,
      status: "pending",
      door: true,
      type: "delete_user",
      order: 1,
      command: `DATA DELETE USERINFO PIN=${pin}`,
      cmdNo: null,
      returnCode: null,
      error: "",
      sentAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  if (staffId)
    await firestore
      .doc(`staff/${staffId}`)
      .update({ firstThumbRegistered: false, updatedAt: now })
      .catch(() => undefined);
}

/** A deleted member is removed from the device and their stored fingerprint is erased. */
/**
 * A member moved to the Recycle Bin: off the machine (the door stops opening for them), but their
 * saved fingerprint and machine link are kept, so a restore lets them in again without a new scan.
 */
async function removeFromDevice(clientId: string, pin: string, deviceId: string) {
  const firestore = db();
  const device = deviceId
    ? (await firestore.doc(`biometricDevices/${deviceId}`).get()).data()
    : null;
  if (!pin || device?.["integrationType"] !== "adms") return;
  const now = FieldValue.serverTimestamp();
  await firestore.collection("biometricCommands").add({
    deviceId,
    serialNumber: String(device["serialNumber"] ?? ""),
    clientId,
    enrollmentId: null,
    biometricUserId: pin,
    status: "pending",
    door: true,
    type: "delete_user",
    order: 1,
    command: `DATA DELETE USERINFO PIN=${pin}`,
    cmdNo: null,
    returnCode: null,
    error: "",
    sentAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function forgetDeletedMember(clientId: string, pin: string, deviceId: string) {
  const firestore = db();
  const device = deviceId
    ? (await firestore.doc(`biometricDevices/${deviceId}`).get()).data()
    : null;
  if (pin && device?.["integrationType"] === "adms") {
    const now = FieldValue.serverTimestamp();
    await firestore.collection("biometricCommands").add({
      deviceId,
      serialNumber: String(device["serialNumber"] ?? ""),
      clientId,
      enrollmentId: null,
      biometricUserId: pin,
      status: "pending",
      door: true,
      type: "delete_user",
      order: 1,
      command: `DATA DELETE USERINFO PIN=${pin}`,
      cmdNo: null,
      returnCode: null,
      error: "",
      sentAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  await firestore.doc(`biometricTemplates/${clientId}`).delete();
  // The machine user list no longer points at the deleted member.
  const linked = await firestore.collection("deviceUsers").where("linkId", "==", clientId).get();
  await Promise.all(
    linked.docs.map((d) =>
      d.ref.update({
        linkType: "",
        linkId: "",
        linkName: "",
        removed: !!pin,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ),
  );
}

/**
 * Fingerprint evidence only counts while staff are actively registering this member (an
 * enroll request from the app in the last 20 minutes). This stops a device's first bulk upload
 * of old users, or anyone posing as the device with its serial number, from activating a
 * member or replacing a saved thumb.
 */
/** Any member or staff thumb registration started from the app in the last 20 minutes. */
/**
 * Same answer as anyLiveEnrollRequest, but a "no" is remembered for 5 s: a machine sending
 * history in 2-second batches then costs one read every few batches, not one per batch. A "yes"
 * is never cached, so a registration that just started is always seen.
 */
let notRegisteringUntil = 0;
async function registeringNow() {
  if (Date.now() < notRegisteringUntil) return false;
  const yes = await anyLiveEnrollRequest();
  if (!yes) notRegisteringUntil = Date.now() + 5000;
  return yes;
}

async function anyLiveEnrollRequest() {
  const since = Timestamp.fromMillis(Date.now() - 2 * ENROLL_REQUEST_TTL_MS);
  const snap = await db().collection("biometricCommands").where("createdAt", ">", since).get();
  return snap.docs.some(
    (d) =>
      ["enroll_fp", "query_fp"].includes(String(d.data()["type"])) &&
      d.data()["status"] !== "cancelled",
  );
}

async function hasLiveEnrollRequest(clientId: string, field: "clientId" | "staffId" = "clientId") {
  const snap = await db().collection("biometricCommands").where(field, "==", clientId).get();
  const since = Date.now() - 2 * ENROLL_REQUEST_TTL_MS;
  return snap.docs.some(
    (d) =>
      ["enroll_fp", "query_fp"].includes(String(d.data()["type"])) &&
      d.data()["status"] !== "cancelled" &&
      createdMs(d.data()) > since,
  );
}

// ---------------------------------------------------------------- attendance

type Membership = { status: string; startDate: string; endDate: string; id: string };

function decide(client: QueryDocumentSnapshot | null, memberships: Membership[], date: string) {
  if (!client) return { allowed: false, reason: "MEMBER_NOT_FOUND", membershipId: null };
  if (client.data()["biometricStatus"] !== "active")
    return { allowed: false, reason: "BIOMETRIC_DISABLED", membershipId: null };
  const valid = memberships.find(
    (m) => ["active", "pending"].includes(m.status) && m.startDate <= date && m.endDate >= date,
  );
  if (valid) return { allowed: true, reason: "ACTIVE_MEMBERSHIP", membershipId: valid.id };
  const expired = memberships.some((m) => m.endDate < date && m.status !== "cancelled");
  return {
    allowed: false,
    reason: expired ? "MEMBERSHIP_EXPIRED" : "NO_ACTIVE_MEMBERSHIP",
    membershipId: null,
  };
}

const EVENT_BY_STATUS: Record<string, string> = {
  "1": "check_out",
  "2": "check_out",
  "5": "check_out",
};

async function attendance(device: Device, body: string) {
  const firestore = db();
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 86_400_000;
  const clients = new Map<string, QueryDocumentSnapshot | null>();
  const memberships = new Map<string, Membership[]>();
  const staffByPin = new Map<string, QueryDocumentSnapshot | null>();
  const machineNames = new Map<string, string>();
  const lastVisits = new Map<string, { ref: DocumentReference; date: string; had: string }>();
  // First thumb of a day per member (they go out and come back: later punches don't count).
  const arrivals = new Map<string, Map<string, string>>();
  const rows: { ref: DocumentReference; data: Row }[] = [];
  const today = localDate();
  const seenUntil = device.attSeenUntil;
  let newest = seenUntil;
  let received = 0;
  for (const raw of body.split(/\r?\n/)) {
    const parts = raw.split("\t").map((p) => p.trim());
    const pin = parts[0];
    const stamp = parts[1];
    if (!pin || !stamp || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(stamp)) continue;
    received += 1;
    const [date = "", time = ""] = stamp.split(" ");
    const at = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}${TZ_OFFSET}`);
    if (Number.isNaN(at.getTime()) || at.getTime() < cutoff) continue;
    // The machine re-sends old days after it reconnects: those are already saved, so they are
    // skipped without reading anything. Today's punches are always checked one by one.
    if (date < today && at.getTime() <= seenUntil) continue;
    newest = Math.max(newest, at.getTime());
    if (!clients.has(pin)) clients.set(pin, await clientForPin(pin, device));
    const client = clients.get(pin) ?? null;
    if (!client) {
      if (!staffByPin.has(pin)) staffByPin.set(pin, await staffForPin(pin, device));
      const staff = staffByPin.get(pin);
      if (staff) {
        const reference = `adms:${device.id}:${pin}:${date}T${time}`;
        rows.push({
          ref: firestore.doc(`staffAttendance/${reference.replace(/[^a-zA-Z0-9_-]/g, "_")}`),
          data: {
            staffId: staff.id,
            staffNameSnapshot: String(staff.data()["name"] ?? ""),
            attendanceDate: date,
            timestamp: at,
            eventType: EVENT_BY_STATUS[parts[2] ?? "0"] ?? "check_in",
            source: "biometric",
            deviceId: device.id,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
        });
        continue;
      }
    }
    if (client && !memberships.has(client.id)) {
      const ms = await firestore.collection("memberships").where("clientId", "==", client.id).get();
      memberships.set(
        client.id,
        ms.docs.map((m) => ({
          id: m.id,
          status: String(m.data()["status"] ?? ""),
          startDate: String(m.data()["startDate"] ?? ""),
          endDate: String(m.data()["endDate"] ?? ""),
        })),
      );
    }
    // Not linked to a member yet: keep the name the machine has for them (from "Read users").
    if (!client && !machineNames.has(pin)) {
      const u = await firestore
        .doc(`deviceUsers/${device.id}_${pin.replace(/[^a-zA-Z0-9_-]/g, "_")}`)
        .get()
        .catch(() => null);
      machineNames.set(pin, String(u?.data()?.["name"] ?? ""));
    }
    const machineName = client ? "" : (machineNames.get(pin) ?? "");
    const decision = decide(client, client ? (memberships.get(client.id) ?? []) : [], date);
    if (client && decision.allowed) {
      const had = String(client.data()["lastVisitDate"] ?? "");
      const mine = arrivals.get(client.id) ?? new Map<string, string>();
      if (date > had && !mine.has(date)) {
        mine.set(date, time.slice(0, 5));
        arrivals.set(client.id, mine);
      }
      const cur = lastVisits.get(client.id);
      if (date > had && (!cur || date > cur.date))
        lastVisits.set(client.id, { ref: client.ref, date, had });
    }
    const reference = `adms:${device.id}:${pin}:${date}T${time}`;
    rows.push({
      ref: firestore.doc(`attendance/${reference.replace(/[^a-zA-Z0-9_-]/g, "_")}`),
      data: {
        clientId: client?.id ?? "",
        clientNameSnapshot: client
          ? String(client.data()["fullName"] ?? "")
          : machineName
            ? `${machineName} (not linked)`
            : "Unknown member",
        biometricUserId: pin,
        deviceId: device.id,
        deviceNameSnapshot: device.name,
        eventType: EVENT_BY_STATUS[parts[2] ?? "0"] ?? "check_in",
        attendanceDate: date,
        timestamp: at,
        source: "biometric",
        accessDecision: decision.allowed ? "allowed" : "blocked",
        accessReason: decision.reason,
        rawEventReference: reference,
        notes: "",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    });
  }
  // Idempotent: the device may upload the same punches again.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const existing = await firestore.getAll(...chunk.map((r) => r.ref));
    const batch = firestore.batch();
    let writes = 0;
    chunk.forEach((r, n) => {
      if (existing[n]?.exists) return;
      batch.set(r.ref, r.data);
      writes += 1;
    });
    if (writes) await batch.commit();
  }
  // Each member's last visit and arrival time. Written in batches under the 500-writes limit, and
  // never allowed to fail the upload: the punches are saved already, and a failed upload is sent
  // again by the machine every few seconds (each time re-reading everything).
  const extras: ((b: WriteBatch) => void)[] = [];
  lastVisits.forEach((v) => extras.push((b) => b.update(v.ref, { lastVisitDate: v.date })));
  arrivals.forEach((days, clientId) =>
    extras.push((b) =>
      b.set(
        firestore.doc(`memberVisits/${clientId}`),
        { clientId, days: Object.fromEntries(days), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      ),
    ),
  );
  for (let i = 0; i < extras.length; i += 400) {
    const b = firestore.batch();
    extras.slice(i, i + 400).forEach((add) => add(b));
    await b.commit().catch((e) => console.error("last visit update failed", String(e)));
  }
  if (rows.length || newest > seenUntil) {
    await firestore.doc(`biometricDevices/${device.id}`).update({
      lastSyncAt: FieldValue.serverTimestamp(),
      attSeenUntil: newest,
    });
    device.attSeenUntil = newest;
  }
  return received;
}

// ---------------------------------------------------------------- HTTP entry

/** What an upload holds: line counts by record type ("USER", "FP", "OPLOG", "PUNCH"…). */
function bodySummary(body: string) {
  const kinds: Record<string, number> = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const k =
      /^([A-Za-z]+)[\s=]/.exec(line)?.[1]?.toUpperCase() ?? (/^\w/.test(line) ? "PUNCH" : "OTHER");
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  return kinds;
}

/**
 * Server-only log of what each machine sends and gets (uploads, commands handed out, errors),
 * to see what a machine is doing when something looks stuck. Never blocks the machine.
 */
function journal(entry: Row) {
  return db()
    .collection("deviceLog")
    .add({ ...entry, at: FieldValue.serverTimestamp() })
    .catch(() => undefined);
}

export async function handleIclock(request: Request, url: URL) {
  const endpoint = (url.pathname.replace(/\/+$/, "").split("/").pop() ?? "").toLowerCase();
  const sn = String(url.searchParams.get("SN") ?? url.searchParams.get("sn") ?? "").trim();
  if (!sn) return text("ERROR: SN required", 400);
  const table = String(url.searchParams.get("table") ?? "").toUpperCase();
  const started = Date.now();
  let body = "";
  try {
    const device = await findDevice(sn);
    if (!device) {
      console.warn("Unregistered biometric device tried to connect", { sn, endpoint });
      return text("OK");
    }
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
    await touchDevice(device, ip);
    body = request.method === "POST" ? await request.text() : "";
    const base = { sn, deviceId: device.id, method: request.method, endpoint, table };
    // Uploads other than single punches are noted when they arrive, so one that never finishes
    // (too slow, too big) still shows up.
    const kinds = bodySummary(body);
    // Users / fingerprints (not the machine re-sending old punches or its operation history).
    const people = (kinds["USER"] ?? 0) + (kinds["FP"] ?? 0) + (kinds["BIODATA"] ?? 0);
    // Old history arrives every 2 s for many minutes: log it at most once a minute.
    const history = request.method === "POST" && !people && body.length > 2000;
    const logThis = !history || Date.now() - (bulkLogAt.get(`${device.id}:${table}`) ?? 0) > 60_000;
    if (history && logThis) bulkLogAt.set(`${device.id}:${table}`, Date.now());
    if (request.method === "POST" && table !== "ATTLOG" && logThis)
      await journal({
        ...base,
        phase: "start",
        bytes: body.length,
        kinds,
        query: url.search.slice(0, 200),
      });

    if (endpoint === "cdata" && request.method === "GET") {
      const ref = db().doc(`biometricDevices/${device.id}`);
      const full =
        (await ref.get()).data()?.["fullUpload"] === true && (await importWindowOpen(device.id));
      if (full) await ref.update({ fullUpload: false });
      await journal({
        ...base,
        phase: "handshake",
        fullUpload: full,
        query: url.search.slice(0, 300),
      });
      return text(handshake(sn, full));
    }
    if (endpoint === "getrequest") {
      const lines = await nextCommands(device);
      if (lines.length)
        await journal({ ...base, phase: "commands", commands: lines.map((l) => l.slice(0, 60)) });
      return text(lines.length ? `${lines.join("\n")}\n` : "OK");
    }
    if (endpoint === "devicecmd") {
      await commandResults(device, body);
      await journal({ ...base, phase: "results", results: body.slice(0, 500) });
      return text("OK");
    }
    if (endpoint === "cdata" || endpoint === "querydata") {
      let count = 0;
      if (table === "ATTLOG") count = await attendance(device, body);
      else {
        count = body.split(/\r?\n/).filter((l) => l.trim()).length;
        // A thumb only counts during a registration started from the app. Old operation history
        // with no thumb records costs no database reads at all.
        const evidence = [...fingerprintEvidence(body)];
        const registering = evidence.length || people ? await registeringNow() : false;
        for (const [pin, kind] of registering ? evidence : []) {
          const client = await clientForPin(pin, device);
          if (!client) {
            const staff = await staffForPin(pin, device);
            if (staff && (await hasLiveEnrollRequest(staff.id, "staffId")))
              await activateStaff(staff.ref, device, pin);
            continue;
          }
          // The ADMS protocol has no device password (only the serial number), so a thumb only
          // counts while staff are registering this member from the app.
          if (!(await hasLiveEnrollRequest(client.id))) continue;
          await activateBiometric(client.ref, device, pin);
        }
        if (registering) await storeTemplates(body, device);
        if (kinds["USER"]) await keepMachineFields(device, body).catch(() => undefined);
        // The machine's own settings (what it supports, e.g. user validity dates).
        if (table === "OPTIONS")
          await db()
            .doc(`biometricDevices/${device.id}`)
            .set(
              {
                machineOptions: body.slice(0, 4000),
                machineOptionsAt: FieldValue.serverTimestamp(),
              },
              { merge: true },
            )
            .catch(() => undefined);
        if (people && (await importWindowOpen(device.id)))
          await importDeviceData(device, machineUsers(body), fingerprintTemplates(body));
      }
      // Single punches are already saved as visits: the log keeps uploads that matter.
      if (logThis && !(table === "ATTLOG" && !history)) {
        await journal({
          ...base,
          phase: "done",
          bytes: body.length,
          count,
          ms: Date.now() - started,
        });
      }
      return text(`OK: ${count}`);
    }
    return text("OK");
  } catch (error) {
    console.error("iclock request failed", { sn, endpoint, error: String(error) });
    await journal({
      sn,
      method: request.method,
      endpoint,
      table,
      phase: "error",
      bytes: body.length,
      kinds: bodySummary(body),
      error: String(error).slice(0, 500),
      ms: Date.now() - started,
    });
    // A non-OK answer makes the machine send the same upload again. For punches that is right
    // (a short outage must not lose visits); any other upload is accepted anyway, so one bad
    // batch can never keep the machine re-sending it forever, blocking punches and commands.
    if (request.method === "POST" && table === "ATTLOG") return text("ERROR", 500);
    return text(request.method === "POST" ? "OK: 0" : "OK");
  }
}

/** Pure protocol helpers, exported only for tests. */
export const __adms = {
  handshake,
  parseKv,
  fingerprintEvidence,
  fingerprintTemplates,
  restoreCommand,
  userInfoCommand,
};
