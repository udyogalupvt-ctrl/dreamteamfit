/**
 * eSSL / ZKTeco "ADMS" (PUSH / iclock) endpoint.
 *
 * The device is configured with Cloud Server = this function's host. It then:
 *   GET  /iclock/cdata?SN=..&options=all   handshake, we answer with push options
 *   GET  /iclock/getrequest?SN=..          polls for queued commands (C:<no>:<command>)
 *   POST /iclock/devicecmd?SN=..           reports each command's Return code
 *   POST /iclock/cdata?SN=..&table=ATTLOG  punches (attendance)
 *   POST /iclock/cdata?SN=..&table=OPERLOG user / fingerprint changes (FP, OPLOG 6)
 *   POST /iclock/cdata?SN=..&table=BIODATA fingerprint templates on newer firmware
 *
 * Only devices registered in /biometricDevices with integrationType "adms" and a matching
 * serial number are served. An uploaded fingerprint template is (1) proof that the member's
 * first thumb was enrolled and (2) kept in /biometricTemplates, a server-only collection that
 * Firestore rules deny to every browser, so the door lock can restore a renewed member to the
 * device without a new scan.
 *
 * Door lock: a member whose plan ended / was cancelled / was blocked by staff is removed from
 * the device (DATA DELETE USERINFO) so the door stays shut; on renewal or unblock the user and
 * stored template are pushed back. Runs on every membership / PT / client change and nightly.
 */
import { getApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

/** Device clocks are set to gym local time (Asia/Kolkata). */
const TZ = "Asia/Kolkata";
const TZ_OFFSET = "+05:30";
/** Punches older than this are skipped, so a first connection does not import years of history. */
const MAX_LOG_AGE_DAYS = 7;
/** An enrollment request the device never picked up is not replayed later at a random moment. */
const ENROLL_REQUEST_TTL_MS = 10 * 60 * 1000;
const POLL_DELAY_SECONDS = 10;

const db = () => getFirestore(getApp());

type Device = { id: string; name: string; serialNumber: string };
type KV = Record<string, string>;

const localDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

// Warm-instance caches: a polling device costs about one device read per minute.
const deviceCache = new Map<string, { device: Device | null; at: number }>();
const lastSeenWrite = new Map<string, number>();

async function findDevice(sn: string): Promise<Device | null> {
  const cached = deviceCache.get(sn);
  if (cached && Date.now() - cached.at < 60_000) return cached.device;
  const snap = await db().collection("biometricDevices").where("serialNumber", "==", sn).get();
  const match = snap.docs.find(
    (d) => d.data()["integrationType"] === "adms" && d.data()["status"] !== "disabled",
  );
  const device = match
    ? { id: match.id, name: String(match.data()["name"] ?? "Device"), serialNumber: sn }
    : null;
  deviceCache.set(sn, { device, at: Date.now() });
  return device;
}

async function touchDevice(device: Device, ip: string) {
  const last = lastSeenWrite.get(device.id) ?? 0;
  if (Date.now() - last < 60_000) return;
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

async function clientForPin(pin: string, device: Device) {
  const snap = await db().collection("clients").where("biometricUserId", "==", pin).get();
  return (
    snap.docs.find((d) => d.data()["biometricDeviceId"] === device.id) ??
    snap.docs.find((d) => !d.data()["biometricDeviceId"]) ??
    null
  );
}

// ---------------------------------------------------------------- handshake

function handshake(sn: string) {
  return [
    `GET OPTION FROM: ${sn}`,
    "ATTLOGStamp=None",
    "OPERLOGStamp=9999",
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

async function nextCommands(device: Device) {
  const firestore = db();
  const deviceRef = firestore.doc(`biometricDevices/${device.id}`);
  const pendingQuery = firestore
    .collection("biometricCommands")
    .where("deviceId", "==", device.id)
    .where("status", "==", "pending");
  return firestore.runTransaction(async (tx) => {
    const [deviceSnap, pending] = await Promise.all([tx.get(deviceRef), tx.get(pendingQuery)]);
    if (pending.empty) return [];
    const now = Date.now();
    const sorted = pending.docs.sort((a, b) => {
      const ta = a.data()["createdAt"]?.toMillis?.() ?? 0;
      const tb = b.data()["createdAt"]?.toMillis?.() ?? 0;
      return ta - tb || Number(a.data()["order"] ?? 0) - Number(b.data()["order"] ?? 0);
    });
    const lines: string[] = [];
    let seq = Number(deviceSnap.data()?.["cmdSeq"] ?? 0);
    for (const cmd of sorted.slice(0, 5)) {
      const d = cmd.data();
      const created = d["createdAt"]?.toMillis?.() ?? now;
      if (d["type"] === "enroll_fp" && now - created > ENROLL_REQUEST_TTL_MS) {
        tx.update(cmd.ref, {
          status: "failed",
          error: "The device did not connect in time. Check it is online, then press Try again.",
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
    if (!client.exists) return false;
    const c = client.data() ?? {};
    if (c["firstThumbRegistered"] === true && c["biometricStatus"] === "active") return false;
    const [enrollments, memberships] = await Promise.all([
      tx.get(firestore.collection("enrollments").where("clientId", "==", client.id)),
      tx.get(firestore.collection("memberships").where("clientId", "==", client.id)),
    ]);
    const now = FieldValue.serverTimestamp();
    const clientPatch: Record<string, unknown> = {
      biometricUserId: pin,
      biometricDeviceId: device.id,
      biometricStatus: "active",
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
      if (ed["ptAssignmentId"])
        tx.update(firestore.doc(`ptAssignments/${String(ed["ptAssignmentId"])}`), {
          status: "active",
          updatedAt: now,
        });
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
    return true;
  });
  if (!activated) return;
  logger.info("First thumb registered", { clientId: clientRef.id, device: device.id, pin });
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
}

/**
 * PINs the device reports as having a fingerprint. "enrolled" = the device logged a new
 * enrollment (OPLOG 6); "template" = a stored template was uploaded. Templates are discarded.
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
  for (const t of fingerprintTemplates(body)) {
    const client = await clientForPin(t.pin, device);
    if (!client) continue;
    const registered = client.data()["firstThumbRegistered"] === true;
    if (!registered && !(await hasLiveEnrollRequest(client.id))) continue;
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
  }
}

// ---------------------------------------------------------------- door lock

/** Entry allowed today: thumb registered, not blocked by staff, and a plan (gym or PT) covers today. */
async function entitledToday(clientId: string, c: Record<string, unknown>, today: string) {
  if (c["firstThumbRegistered"] !== true || c["biometricStatus"] !== "active") return false;
  const firestore = db();
  const [ms, pts] = await Promise.all([
    firestore.collection("memberships").where("clientId", "==", clientId).get(),
    firestore.collection("ptAssignments").where("clientId", "==", clientId).get(),
  ]);
  const covers = (d: Record<string, unknown>, statuses: string[]) =>
    statuses.includes(String(d["status"])) &&
    String(d["startDate"] ?? "") <= today &&
    String(d["endDate"] ?? "") >= today;
  return (
    ms.docs.some((m) => covers(m.data(), ["active", "pending"])) ||
    pts.docs.some((p) => covers(p.data(), ["active"]))
  );
}

/**
 * Brings the device in line with the member's entitlement. Returns what changed:
 * "removed" (door closed for them), "restored" (user + thumb pushed back),
 * "needs_thumb" (entitled again but no stored template: staff must register the thumb),
 * "flipped" (an unsent opposite command was withdrawn) or "none".
 */
export async function syncDoorAccess(clientId: string, today = localDate()) {
  const firestore = db();
  const ref = firestore.doc(`clients/${clientId}`);
  const c = (await ref.get()).data();
  if (!c) return "none";
  const pin = String(c["biometricUserId"] ?? "");
  const deviceId = String(c["biometricDeviceId"] ?? "");
  if (c["firstThumbRegistered"] !== true || !pin || !deviceId) return "none";
  const device = (await firestore.doc(`biometricDevices/${deviceId}`).get()).data();
  if (!device || device["integrationType"] !== "adms") return "none";

  const entitled = await entitledToday(clientId, c, today);
  const onDevice = c["deviceAccess"] !== "removed";
  if (entitled === onDevice) return "none";

  const now = FieldValue.serverTimestamp();
  const cmds = await firestore
    .collection("biometricCommands")
    .where("clientId", "==", clientId)
    .get();
  const unsent = cmds.docs.filter(
    (d) => d.data()["door"] === true && d.data()["status"] === "pending",
  );
  if (unsent.length) {
    // The device never ran the last change, so it is still in the state we now want.
    const batch = firestore.batch();
    unsent.forEach((d) => batch.update(d.ref, { status: "cancelled", updatedAt: now }));
    batch.update(ref, { deviceAccess: entitled ? "on" : "removed", deviceAccessChangedAt: now });
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

  if (!entitled) {
    add("delete_user", 1, `DATA DELETE USERINFO PIN=${pin}`);
    batch.update(ref, { deviceAccess: "removed", deviceAccessChangedAt: now });
    await batch.commit();
    logger.info("Door access removed", { clientId, pin });
    return "removed";
  }

  const tpl = await firestore.doc(`biometricTemplates/${clientId}`).get();
  const fingers = Object.values(
    (tpl.data()?.["fingers"] ?? {}) as Record<string, { format: "FP" | "BIODATA"; fields: KV }>,
  );
  add("user_upsert", 1, userInfoCommand(pin, String(c["fullName"] ?? "")));
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
    return "needs_thumb";
  }
  fingers.forEach((t, i) => add("restore_fp", 2 + i, restoreCommand(pin, t)));
  batch.update(ref, { deviceAccess: "on", deviceAccessChangedAt: now });
  await batch.commit();
  logger.info("Door access restored", { clientId, pin, fingers: fingers.length });
  return "restored";
}

type WriteEvent = {
  data?: {
    before?: { data(): Record<string, unknown> | undefined };
    after?: { data(): Record<string, unknown> | undefined };
  };
};
const clientIdOf = (e: WriteEvent) =>
  String(e.data?.after?.data()?.["clientId"] ?? e.data?.before?.data()?.["clientId"] ?? "");

export const doorAccessOnMembership = onDocumentWritten("memberships/{id}", async (e) => {
  const id = clientIdOf(e);
  if (id) await syncDoorAccess(id);
});

export const doorAccessOnPt = onDocumentWritten("ptAssignments/{id}", async (e) => {
  const id = clientIdOf(e);
  if (id) await syncDoorAccess(id);
});

/** Staff "Block entry" / "Allow entry", or a thumb just registered. */
export const doorAccessOnClient = onDocumentWritten("clients/{id}", async (e) => {
  const before = e.data?.before?.data();
  const after = e.data?.after?.data();
  if (!after) {
    if (before) await forgetDeletedMember(e.params.id, before);
    return;
  }
  if (
    before &&
    before["biometricStatus"] === after["biometricStatus"] &&
    before["firstThumbRegistered"] === after["firstThumbRegistered"]
  )
    return;
  await syncDoorAccess(e.params.id);
});

/** A deleted member is removed from the device and their stored fingerprint is erased. */
async function forgetDeletedMember(clientId: string, c: Record<string, unknown>) {
  const firestore = db();
  const pin = String(c["biometricUserId"] ?? "");
  const deviceId = String(c["biometricDeviceId"] ?? "");
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
  logger.info("Deleted member removed from device", { clientId, pin });
}

/** Plans end at midnight without any write, so check everyone once a day. */
export const dailyDoorAccessSync = onSchedule(
  { schedule: "every day 00:05", timeZone: TZ },
  async () => {
    const clients = await db()
      .collection("clients")
      .where("firstThumbRegistered", "==", true)
      .get();
    let changed = 0;
    for (const c of clients.docs) if ((await syncDoorAccess(c.id)) !== "none") changed += 1;
    logger.info("Daily door access sync", { checked: clients.size, changed });
  },
);

/**
 * A stored template only proves enrollment while staff are actively registering this member,
 * so a device's first bulk upload of old users can never activate someone by ID coincidence.
 */
async function hasLiveEnrollRequest(clientId: string) {
  const snap = await db().collection("biometricCommands").where("clientId", "==", clientId).get();
  const since = Date.now() - 2 * ENROLL_REQUEST_TTL_MS;
  return snap.docs.some(
    (d) =>
      ["enroll_fp", "query_fp"].includes(String(d.data()["type"])) &&
      d.data()["status"] !== "cancelled" &&
      (d.data()["createdAt"]?.toMillis?.() ?? 0) > since,
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
  const rows: { ref: DocumentReference; data: Record<string, unknown> }[] = [];
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
    if (!clients.has(pin)) clients.set(pin, await clientForPin(pin, device));
    const client = clients.get(pin) ?? null;
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
    const decision = decide(client, client ? (memberships.get(client.id) ?? []) : [], date);
    const reference = `adms:${device.id}:${pin}:${date}T${time}`;
    rows.push({
      ref: firestore.doc(`attendance/${reference.replace(/[^a-zA-Z0-9_-]/g, "_")}`),
      data: {
        clientId: client?.id ?? "",
        clientNameSnapshot: client ? String(client.data()["fullName"] ?? "") : "Unknown member",
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
  if (rows.length)
    await firestore
      .doc(`biometricDevices/${device.id}`)
      .update({ lastSyncAt: FieldValue.serverTimestamp() });
  return received;
}

// ---------------------------------------------------------------- HTTP entry

export const iclock = onRequest({ memory: "256MiB", timeoutSeconds: 120 }, async (req, res) => {
  res.set("Content-Type", "text/plain");
  const endpoint = (req.path.replace(/\/+$/, "").split("/").pop() ?? "").toLowerCase();
  const sn = String(req.query["SN"] ?? req.query["sn"] ?? "").trim();
  if (!sn) {
    res.status(400).send("ERROR: SN required");
    return;
  }
  try {
    const device = await findDevice(sn);
    if (!device) {
      logger.warn("Unregistered biometric device tried to connect", { sn, endpoint });
      res.status(200).send("OK");
      return;
    }
    await touchDevice(device, String(req.ip ?? ""));
    const body = req.rawBody ? req.rawBody.toString("utf8") : "";

    if (endpoint === "cdata" && req.method === "GET") {
      res.status(200).send(handshake(sn));
      return;
    }
    if (endpoint === "getrequest") {
      const lines = await nextCommands(device);
      res.status(200).send(lines.length ? `${lines.join("\n")}\n` : "OK");
      return;
    }
    if (endpoint === "devicecmd") {
      await commandResults(device, body);
      res.status(200).send("OK");
      return;
    }
    if (endpoint === "cdata" || endpoint === "querydata") {
      const table = String(req.query["table"] ?? "").toUpperCase();
      let count = 0;
      if (table === "ATTLOG") count = await attendance(device, body);
      else {
        count = body.split(/\r?\n/).filter((l) => l.trim()).length;
        for (const [pin, kind] of fingerprintEvidence(body)) {
          const client = await clientForPin(pin, device);
          if (!client) continue;
          if (kind === "template" && !(await hasLiveEnrollRequest(client.id))) continue;
          await activateBiometric(client.ref, device, pin);
        }
        await storeTemplates(body, device);
      }
      res.status(200).send(`OK: ${count}`);
      return;
    }
    res.status(200).send("OK");
  } catch (error) {
    logger.error("iclock request failed", { sn, endpoint, error: String(error) });
    // A non-OK answer makes the device retry the same upload later.
    res.status(500).send("ERROR");
  }
});

/** Pure protocol helpers, exported only for tests. */
export const __adms = {
  handshake,
  parseKv,
  fingerprintEvidence,
  fingerprintTemplates,
  restoreCommand,
  userInfoCommand,
};
