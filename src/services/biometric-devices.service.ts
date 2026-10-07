import {
  addDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { adapterFor } from "@/lib/biometric-adapters";
import { db } from "@/lib/firebase";
import { callServer } from "@/lib/server-api";
import type { BiometricCommand, BiometricDevice, DeviceUser } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";

export type DeviceInput = Omit<
  BiometricDevice,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "lastSyncAt"
  | "lastSeenAt"
  | "doorControl"
  | "sendPhotos"
  | "importUntil"
  | "lastImportAt"
  | "freshStartAt"
>;

export const mapDevice = (id: string, d: DocumentData): BiometricDevice => ({
  id,
  name: d["name"] ?? "",
  manufacturer: d["manufacturer"] ?? "Other",
  model: d["model"] ?? "",
  serialNumber: d["serialNumber"] ?? "",
  deviceType: d["deviceType"] ?? "Biometric terminal",
  location: d["location"] ?? "",
  connectionType: d["connectionType"] ?? "Other",
  ipAddress: d["ipAddress"] ?? "",
  port: d["port"] == null ? null : Number(d["port"]),
  status: d["status"] ?? "unknown",
  integrationType: d["integrationType"] ?? "manual",
  lastSyncAt: d["lastSyncAt"] ? toDate(d["lastSyncAt"]) : null,
  lastSeenAt: d["lastSeenAt"] ? toDate(d["lastSeenAt"]) : null,
  doorControl: d["doorControl"] === true,
  sendPhotos: d["sendPhotos"] === true,
  importUntil: d["importUntil"] ? toDate(d["importUntil"]) : null,
  lastImportAt: d["lastImportAt"] ? toDate(d["lastImportAt"]) : null,
  freshStartAt: d["freshStartAt"] ? toDate(d["freshStartAt"]) : null,
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

export const mapBiometricCommand = (id: string, d: DocumentData): BiometricCommand => ({
  id,
  deviceId: d["deviceId"] ?? "",
  serialNumber: d["serialNumber"] ?? "",
  clientId: d["clientId"] ?? "",
  enrollmentId: d["enrollmentId"] ?? null,
  biometricUserId: d["biometricUserId"] ?? "",
  door: d["door"] === true,
  ...(d["noThumbCopy"] === true ? { noThumbCopy: true } : {}),
  type: d["type"] ?? "user_upsert",
  command: d["command"] ?? "",
  order: Number(d["order"] ?? 0),
  status: d["status"] ?? "pending",
  cmdNo: d["cmdNo"] == null ? null : Number(d["cmdNo"]),
  returnCode: d["returnCode"] == null ? null : Number(d["returnCode"]),
  error: d["error"] ?? "",
  sentAt: d["sentAt"] ? toDate(d["sentAt"]) : null,
  completedAt: d["completedAt"] ? toDate(d["completedAt"]) : null,
  createdAt: toDate(d["createdAt"]),
  updatedAt: toDate(d["updatedAt"]),
});

/** ADMS devices poll every ~15 s ("last contact" is saved every 2 min); 5 minutes without = offline. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function deviceConnection(device: BiometricDevice, now = Date.now()) {
  if (device.status === "disabled") return { online: false, label: "Disabled" } as const;
  if (device.integrationType === "adms") {
    if (!device.lastSeenAt) return { online: false, label: "Never connected" } as const;
    return now - device.lastSeenAt.getTime() < ONLINE_WINDOW_MS
      ? ({ online: true, label: "Online" } as const)
      : ({ online: false, label: "Offline" } as const);
  }
  if (device.integrationType === "mock") return { online: false, label: "Test only" } as const;
  return { online: false, label: "Not linked" } as const;
}

export const subscribeDevices = (ok: (x: BiometricDevice[]) => void, fail: (e: Error) => void) =>
  subscribeCollection(
    COLLECTIONS.biometricDevices,
    mapDevice,
    ok,
    fail,
    orderBy("createdAt", "desc"),
  );

export const subscribeClientBiometricCommands = (
  clientId: string,
  ok: (x: BiometricCommand[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.biometricCommands), where("clientId", "==", clientId)),
    mapBiometricCommand,
    (x) => ok(x.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    fail,
  );

const devices = () => col(COLLECTIONS.biometricDevices);

export async function saveDevice(input: DeviceInput, id?: string) {
  const data = {
    ...input,
    serialNumber: input.serialNumber.trim().toUpperCase(),
    updatedAt: serverTimestamp(),
  };
  if (id) {
    await updateDoc(doc(devices(), id), data);
    return id;
  }
  const ref = await addDoc(devices(), {
    ...data,
    lastSyncAt: null,
    lastSeenAt: null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function setDeviceStatus(id: string, status: BiometricDevice["status"]) {
  await updateDoc(doc(db, COLLECTIONS.biometricDevices, id), {
    status,
    updatedAt: serverTimestamp(),
  });
}

export async function testDeviceConnection(device: BiometricDevice) {
  if (device.integrationType === "adms") {
    const c = deviceConnection(device);
    return c.online
      ? { ok: true, message: `${device.name} is online and talking to the cloud.` }
      : {
          ok: false,
          message: device.lastSeenAt
            ? `${device.name} has not connected for a while. Check its power and network.`
            : `${device.name} has never connected. Check the Cloud Server settings on the device.`,
        };
  }
  return adapterFor(device).testConnection();
}

// ---------------------------------------------------------------- users already on a machine

export const mapDeviceUser = (id: string, d: DocumentData): DeviceUser => ({
  id,
  deviceId: d["deviceId"] ?? "",
  pin: String(d["pin"] ?? ""),
  name: d["name"] ?? "",
  hasFingerprint: d["hasFingerprint"] === true,
  fingerCount: Array.isArray(d["fingerKeys"]) ? d["fingerKeys"].length : 0,
  admin: d["admin"] === true,
  linkType: d["linkType"] === "client" || d["linkType"] === "staff" ? d["linkType"] : "",
  linkId: d["linkId"] ?? "",
  linkName: d["linkName"] ?? "",
  removed: d["removed"] === true,
});

/** How many people are on the machine (a count costs about 1 read per 1,000). */
export const countDeviceUsers = async (deviceId: string) =>
  (
    await getCountFromServer(query(col(COLLECTIONS.deviceUsers), where("deviceId", "==", deviceId)))
  ).data().count;

/** Everyone on the machine, loaded once when asked for (a machine can hold 1,000 people). */
export const loadDeviceUsers = async (deviceId: string) =>
  (await getDocs(query(col(COLLECTIONS.deviceUsers), where("deviceId", "==", deviceId)))).docs
    .map((d) => mapDeviceUser(d.id, d.data()))
    .sort((a, b) => Number(a.pin) - Number(b.pin) || a.pin.localeCompare(b.pin));

/** Names the machine has for some IDs ("<deviceId>_<pin>" → name, "" when unknown). */
export async function machineUserNames(keys: string[]) {
  const out: Record<string, string> = {};
  await Promise.all(
    keys.map(async (k) => {
      const s = await getDoc(
        doc(db, COLLECTIONS.deviceUsers, k.replace(/[^a-zA-Z0-9_-]/g, "_")),
      ).catch(() => null);
      out[k] = String(s?.data()?.["name"] ?? "");
    }),
  );
  return out;
}

export const subscribeDeviceUsers = (
  deviceId: string,
  ok: (x: DeviceUser[]) => void,
  fail: (e: Error) => void,
) =>
  subscribeQuery(
    query(col(COLLECTIONS.deviceUsers), where("deviceId", "==", deviceId)),
    mapDeviceUser,
    (rows) => ok(rows.sort((a, b) => Number(a.pin) - Number(b.pin))),
    fail,
  );

/** Asks the machine to send everyone registered on it (window of 30 minutes). */
export const readUsersFromMachine = (deviceId: string) =>
  callServer<{ ok: true }>("/api/devices/read-users", { deviceId });

/**
 * After the machine itself was wiped: everyone registers their thumb again (owner only). The
 * server keeps a copy of what it clears.
 */
export const freshStartMachine = (deviceId: string) =>
  callServer<{
    ok: true;
    resetId: string;
    members: number;
    staff: number;
    thumbs: number;
    machineUsers: number;
    commands: number;
  }>("/api/devices/fresh-start", { deviceId });

/** Members and staff with a thumb registered again since the last fresh start. */
export async function registeredSinceReset() {
  const [members, staff] = await Promise.all([
    getCountFromServer(query(col(COLLECTIONS.clients), where("firstThumbRegistered", "==", true))),
    getCountFromServer(query(col(COLLECTIONS.staff), where("firstThumbRegistered", "==", true))),
  ]);
  return { members: members.data().count, staff: staff.data().count };
}

/** Links a machine ID to a member or staff member; both empty = unlink. */
export const linkMachineUser = (
  deviceId: string,
  pin: string,
  to: { clientId?: string; staffId?: string },
) => callServer<{ ok: true }>("/api/devices/link", { deviceId, pin, ...to });

/** Takes someone who is not a member or staff here off the machine. */
export const removeMachineUser = (deviceId: string, pin: string) =>
  callServer<{ ok: true }>("/api/devices/remove", { deviceId, pin });

/**
 * Door control on/off. Turning it on re-checks everyone at the machine's next contact (not only
 * after midnight), so members whose plan already ended are locked out straight away.
 */
export const setSendPhotos = (deviceId: string, on: boolean) =>
  updateDoc(doc(db, COLLECTIONS.biometricDevices, deviceId), {
    sendPhotos: on,
    updatedAt: serverTimestamp(),
  });

export const setDoorControl = (deviceId: string, on: boolean) =>
  updateDoc(doc(db, COLLECTIONS.biometricDevices, deviceId), {
    doorControl: on,
    ...(on ? { lastDoorSyncDate: "" } : {}),
    updatedAt: serverTimestamp(),
  });
