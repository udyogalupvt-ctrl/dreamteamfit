/**
 * Users already on a fingerprint machine (e.g. registered by the gym's old software).
 *
 *   POST /api/devices/read-users  { deviceId }                    ask the machine for everyone
 *   POST /api/devices/link        { deviceId, pin, clientId | staffId | (none = unlink) }
 *   POST /api/devices/remove      { deviceId, pin }                take someone off the machine
 *
 * "Read users" opens a 30-minute window in which the machine's upload of its users and
 * fingerprints is accepted (the ADMS protocol has no device password, so uploads outside an
 * owner-started window never link or activate anyone). Each machine user is kept in
 * /deviceUsers (listed in the app) and its fingerprints in /deviceUserTemplates (server only).
 * Users whose machine ID matches a staff member or a member (their Member ID) are linked
 * automatically; the rest are linked by hand. A linked member keeps the fingerprint already on
 * the machine: nobody has to scan again, and the door lock can restore it after a renewal.
 */
import { FieldValue } from "firebase-admin/firestore";
import { db, json, localDate, requireFeature } from "./admin";
import { systemAudit } from "./audit";

type KV = Record<string, string>;
export type Template = { pin: string; key: string; format: "FP" | "BIODATA"; fields: KV };
export type MachineUser = { pin: string; name: string; privilege: string };
type DeviceInfo = { id: string; name: string; serialNumber: string };

/** How long the machine's upload is accepted after the owner presses "Read users". */
export const IMPORT_WINDOW_MS = 30 * 60 * 1000;

const userRef = (deviceId: string, pin: string) =>
  db().doc(`deviceUsers/${deviceId}_${pin.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
const templatesRef = (deviceId: string, pin: string) =>
  db().doc(`deviceUserTemplates/${deviceId}_${pin.replace(/[^a-zA-Z0-9_-]/g, "_")}`);

/** An owner-started "Read users" is still open for this machine. */
export async function importWindowOpen(deviceId: string) {
  const d = (await db().doc(`biometricDevices/${deviceId}`).get()).data();
  const until = (d?.["importUntil"] as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
  return until > Date.now();
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3);
/** "RAMESH K" and "Ramesh Kumar" agree; "SURESH" and "Govardhan" don't. */
export function namesAgree(machineName: string, appName: string) {
  const a = words(machineName);
  const b = words(appName);
  return a.some((x) =>
    b.some(
      (y) => x === y || (x.length >= 4 && y.startsWith(x)) || (y.length >= 4 && x.startsWith(y)),
    ),
  );
}

/**
 * Who this machine ID belongs to in the app: staff (their device ID) or a member. The same
 * number alone is not enough for a member added here before the old list was read (their ID was
 * picked by this app, and the old machine may use it for someone else): the names must agree,
 * unless the member was imported from the old software (the ID then came from the same place).
 */
async function autoMatch(device: DeviceInfo, pin: string, machineName: string) {
  const firestore = db();
  const staff = await firestore.collection("staff").where("biometricUserId", "==", pin).get();
  const s = staff.docs.find((d) =>
    [device.id, ""].includes(String(d.data()["biometricDeviceId"] ?? "")),
  );
  if (s) return { type: "staff" as const, id: s.id, name: String(s.data()["name"] ?? "") };
  const trusted = (d: FirebaseFirestore.QueryDocumentSnapshot, sameMachine: boolean) => {
    const name = String(d.data()["fullName"] ?? "");
    if (machineName.trim()) return namesAgree(machineName, name);
    return sameMachine || Boolean(d.data()["importBatchId"]);
  };
  const byPin = await firestore.collection("clients").where("biometricUserId", "==", pin).get();
  const c = byPin.docs.find((d) => {
    const on = String(d.data()["biometricDeviceId"] ?? "");
    // Put on this machine by this app: certain. Not tied to a machine yet: check the name.
    return on === device.id || (on === "" && trusted(d, false));
  });
  if (c) return { type: "client" as const, id: c.id, name: String(c.data()["fullName"] ?? "") };
  const byCode = await firestore.collection("clients").where("clientCode", "==", pin).get();
  // Same Member ID, not already linked to another machine ID, and the same person.
  const m = byCode.docs.find((d) => !d.data()["biometricUserId"] && trusted(d, false));
  if (m) return { type: "client" as const, id: m.id, name: String(m.data()["fullName"] ?? "") };
  return null;
}

/**
 * Links a machine user to a member or staff member (or unlinks when target is null). A member
 * with a fingerprint on the machine becomes "thumb registered" with that fingerprint saved.
 */
async function linkTo(
  device: DeviceInfo,
  pin: string,
  target: { type: "client" | "staff"; id: string; name: string } | null,
  by: string,
) {
  const firestore = db();
  const now = FieldValue.serverTimestamp();
  const uRef = userRef(device.id, pin);
  const u = (await uRef.get()).data() ?? {};
  const tpl = (await templatesRef(device.id, pin).get()).data();
  const fingers = (tpl?.["fingers"] ?? {}) as Record<string, unknown>;
  const hasFp = Object.keys(fingers).length > 0;

  // Undo the previous link first.
  const prevType = String(u["linkType"] ?? "");
  const prevId = String(u["linkId"] ?? "");
  if (prevId && (prevType !== target?.type || prevId !== target?.id)) {
    if (prevType === "client") {
      await firestore.doc(`clients/${prevId}`).update({
        biometricUserId: "",
        biometricDeviceId: "",
        biometricStatus: "not_enrolled",
        firstThumbRegistered: false,
        updatedAt: now,
      });
      await firestore.doc(`biometricTemplates/${prevId}`).delete();
    } else if (prevType === "staff")
      await firestore.doc(`staff/${prevId}`).update({
        biometricUserId: "",
        biometricDeviceId: "",
        firstThumbRegistered: false,
        updatedAt: now,
      });
  }

  if (target?.type === "client") {
    const ref = firestore.doc(`clients/${target.id}`);
    const c = (await ref.get()).data();
    if (!c) throw new Error("Member not found.");
    await ref.update({
      biometricUserId: pin,
      biometricDeviceId: device.id,
      deviceAccess: "on",
      ...(hasFp
        ? {
            firstThumbRegistered: true,
            biometricStatus: "active",
            // Visits before today were counted by the old software, not here.
            ...(c["firstThumbRegistered"] === true ? {} : { thumbSince: localDate() }),
          }
        : {}),
      updatedAt: now,
    });
    if (hasFp) {
      await firestore
        .doc(`biometricTemplates/${target.id}`)
        .set({ clientId: target.id, deviceId: device.id, pin, fingers, updatedAt: now });
      // A joining that was waiting for this member's first thumb is finished.
      const eid = String(c["enrollmentId"] ?? "");
      if (eid) {
        const e = await firestore.doc(`enrollments/${eid}`).get();
        if (e.data()?.["status"] === "biometric_pending")
          await e.ref.update({
            status: "active",
            biometricUserId: pin,
            biometricDeviceId: device.id,
            firstThumbRegistered: true,
            updatedAt: now,
          });
      }
    }
  } else if (target?.type === "staff") {
    await firestore.doc(`staff/${target.id}`).update({
      biometricUserId: pin,
      biometricDeviceId: device.id,
      firstThumbRegistered: hasFp,
      updatedAt: now,
    });
  }

  await uRef.set(
    {
      linkType: target?.type ?? "",
      linkId: target?.id ?? "",
      linkName: target?.name ?? "",
      linkedBy: target ? by : "",
      updatedAt: now,
    },
    { merge: true },
  );
  if (target && u["linkId"] !== target.id)
    await systemAudit({
      collection: target.type === "client" ? "clients" : "staff",
      docId: target.id,
      ...(target.type === "client" ? { clientId: target.id, clientName: target.name } : {}),
      summary: `Machine user ${pin}${u["name"] ? ` (${String(u["name"])})` : ""} linked to ${target.name}${hasFp ? ", fingerprint kept" : ", no fingerprint on the machine yet"}`,
    });
}

/**
 * The machine uploaded users and/or fingerprints while "Read users" was open: keep them, link
 * the matching ones, and give linked members their saved fingerprint.
 */
export async function importDeviceData(
  device: DeviceInfo,
  users: MachineUser[],
  templates: Template[],
  // Answer the machine quickly: whatever isn't linked by then is linked on its next check-ins.
  deadline = Date.now() + 5000,
) {
  const firestore = db();
  const now = FieldValue.serverTimestamp();
  // A machine can hold hundreds of people: write in bulk, not one by one.
  const writer = firestore.bulkWriter();
  for (const u of users)
    void writer.set(
      userRef(device.id, u.pin),
      {
        deviceId: device.id,
        pin: u.pin,
        name: u.name,
        // 14 = machine administrator (can open the machine's menu).
        admin: u.privilege === "14",
        removed: false,
        seenAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  const byPin = new Map<string, Template[]>();
  for (const t of templates) byPin.set(t.pin, [...(byPin.get(t.pin) ?? []), t]);
  for (const [pin, list] of byPin) {
    void writer.set(
      templatesRef(device.id, pin),
      {
        deviceId: device.id,
        pin,
        fingers: Object.fromEntries(
          list.map((t) => [t.key, { format: t.format, fields: t.fields }]),
        ),
        updatedAt: now,
      },
      { merge: true },
    );
    void writer.set(
      userRef(device.id, pin),
      {
        deviceId: device.id,
        pin,
        hasFingerprint: true,
        fingerKeys: FieldValue.arrayUnion(...list.map((t) => t.key)),
        removed: false,
        seenAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }
  await writer.close();

  // Link the matching ones; refresh a link when new fingerprints came in (a few at a time).
  const names = new Map(users.map((u) => [u.pin, u.name]));
  const pins = [...new Set([...names.keys(), ...byPin.keys()])];
  const work = async (pin: string) => {
    const cur = (await userRef(device.id, pin).get()).data() ?? {};
    if (cur["linkId"]) {
      if (byPin.has(pin))
        await linkTo(
          device,
          pin,
          {
            type: String(cur["linkType"]) as "client" | "staff",
            id: String(cur["linkId"]),
            name: String(cur["linkName"] ?? ""),
          },
          String(cur["linkedBy"] ?? "matched by machine ID"),
        );
      return;
    }
    const match = await autoMatch(device, pin, names.get(pin) ?? String(cur["name"] ?? ""));
    if (match) await linkTo(device, pin, match, "matched by machine ID and name");
  };
  let k = 0;
  for (; k < pins.length && Date.now() < deadline; k += 10)
    await Promise.all(pins.slice(k, k + 10).map(work));
  const later = pins.slice(k);
  if (later.length) {
    const w = firestore.bulkWriter();
    for (const pin of later)
      void w.set(userRef(device.id, pin), { needsMatch: true }, { merge: true });
    await w.close();
  }
  if (pins.length)
    await firestore.doc(`biometricDevices/${device.id}`).update({
      lastImportAt: now,
      ...(later.length ? { pendingMatches: true } : {}),
      updatedAt: now,
    });
}

/** Links machine users whose upload came in faster than they could be matched (a few per call). */
export async function matchPending(device: DeviceInfo, budgetMs = 3000) {
  const deadline = Date.now() + budgetMs;
  const firestore = db();
  const snap = await firestore
    .collection("deviceUsers")
    .where("deviceId", "==", device.id)
    .where("needsMatch", "==", true)
    .limit(40)
    .get();
  if (snap.empty) {
    await firestore.doc(`biometricDevices/${device.id}`).update({ pendingMatches: false });
    return 0;
  }
  let done = 0;
  for (let k = 0; k < snap.docs.length && Date.now() < deadline; k += 10) {
    await Promise.all(
      snap.docs.slice(k, k + 10).map(async (d) => {
        const u = d.data();
        const pin = String(u["pin"] ?? "");
        const hasTpl = (await templatesRef(device.id, pin).get()).exists;
        if (u["linkId"]) {
          if (hasTpl)
            await linkTo(
              device,
              pin,
              {
                type: String(u["linkType"]) as "client" | "staff",
                id: String(u["linkId"]),
                name: String(u["linkName"] ?? ""),
              },
              String(u["linkedBy"] ?? "matched by machine ID"),
            );
        } else {
          const match = await autoMatch(device, pin, String(u["name"] ?? ""));
          if (match) await linkTo(device, pin, match, "matched by machine ID and name");
        }
        await d.ref.update({ needsMatch: false });
        done += 1;
      }),
    );
  }
  return done;
}

// ---------------------------------------------------------------- app endpoints

const command = (
  device: DeviceInfo & Record<string, unknown>,
  type: string,
  cmd: string,
  pin = "",
) => ({
  deviceId: device.id,
  serialNumber: device.serialNumber,
  clientId: "",
  enrollmentId: null,
  biometricUserId: pin,
  door: type === "delete_user",
  type,
  order: 1,
  command: cmd,
  status: "pending",
  cmdNo: null,
  returnCode: null,
  error: "",
  sentAt: null,
  completedAt: null,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

async function loadDevice(deviceId: string) {
  const snap = await db().doc(`biometricDevices/${deviceId}`).get();
  const d = snap.data();
  if (!d || d["integrationType"] !== "adms") return null;
  return {
    id: snap.id,
    name: String(d["name"] ?? "Device"),
    serialNumber: String(d["serialNumber"] ?? ""),
  };
}

export async function handleDeviceUsers(request: Request, url: URL) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const user = await requireFeature(request, "devices");
  if (!user)
    return json({ error: "Only the owner or a login with Fingerprint devices can do this." }, 403);
  const by = String(user["name"] ?? user.email ?? "Staff");
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const device = await loadDevice(String(body["deviceId"] ?? ""));
  if (!device) return json({ error: "Fingerprint machine not found (cloud / ADMS only)." }, 404);
  const action = url.pathname.replace(/^\/api\/devices\/?/, "").replace(/\/+$/, "");
  const firestore = db();

  if (action === "read-users") {
    // Pressed again while a read is still going: keep the window open, don't ask twice.
    const recent = await firestore
      .collection("biometricCommands")
      .where("deviceId", "==", device.id)
      .get();
    const busy = recent.docs.some(
      (d) =>
        String(d.data()["type"]).startsWith("import_") &&
        ["pending", "sent"].includes(String(d.data()["status"])) &&
        Date.now() - ((d.data()["createdAt"] as { toMillis?: () => number })?.toMillis?.() ?? 0) <
          10 * 60 * 1000,
    );
    if (busy) {
      await firestore.doc(`biometricDevices/${device.id}`).update({
        importUntil: new Date(Date.now() + IMPORT_WINDOW_MS),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return json({ ok: true, alreadyReading: true });
    }
    const batch = firestore.batch();
    batch.update(firestore.doc(`biometricDevices/${device.id}`), {
      importUntil: new Date(Date.now() + IMPORT_WINDOW_MS),
      importRequestedAt: FieldValue.serverTimestamp(),
      importRequestedBy: by,
      updatedAt: FieldValue.serverTimestamp(),
    });
    // Only the two queries: a CHECK / full re-sync also makes the machine re-send its whole
    // punch history (tens of thousands on the gym's MB360), and it takes no new work meanwhile.
    for (const [type, cmd] of [
      ["import_users", "DATA QUERY USERINFO"],
      ["import_fp", "DATA QUERY FINGERTMP"],
    ] as const)
      batch.set(firestore.collection("biometricCommands").doc(), command(device, type, cmd));
    await batch.commit();
    return json({ ok: true });
  }

  const pin = String(body["pin"] ?? "").trim();
  if (!/^[A-Za-z0-9]{1,24}$/.test(pin)) return json({ error: "Machine ID not valid." }, 400);

  if (action === "link") {
    const clientId = String(body["clientId"] ?? "");
    const staffId = String(body["staffId"] ?? "");
    let target: { type: "client" | "staff"; id: string; name: string } | null = null;
    if (clientId) {
      const c = await firestore.doc(`clients/${clientId}`).get();
      if (!c.exists) return json({ error: "Member not found." }, 404);
      const other = String(c.data()?.["biometricUserId"] ?? "");
      if (other && other !== pin)
        return json({ error: `This member already has machine ID ${other}.` }, 409);
      target = { type: "client", id: clientId, name: String(c.data()?.["fullName"] ?? "") };
    } else if (staffId) {
      const s = await firestore.doc(`staff/${staffId}`).get();
      if (!s.exists) return json({ error: "Staff member not found." }, 404);
      target = { type: "staff", id: staffId, name: String(s.data()?.["name"] ?? "") };
    }
    await linkTo(device, pin, target, by);
    return json({ ok: true });
  }

  if (action === "remove") {
    const u = (await userRef(device.id, pin).get()).data();
    if (!u) return json({ error: "That ID is not in the machine's user list." }, 404);
    if (u["linkId"])
      return json({ error: "Linked people are handled by the door lock. Unlink first." }, 409);
    await firestore
      .collection("biometricCommands")
      .add(command(device, "delete_user", `DATA DELETE USERINFO PIN=${pin}`, pin));
    await userRef(device.id, pin).set(
      { removed: true, removedBy: by, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await systemAudit({
      collection: "biometricDevices",
      docId: device.id,
      summary: `Machine user ${pin}${u["name"] ? ` (${String(u["name"])})` : ""} taken off ${device.name} by ${by}`,
    });
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}
