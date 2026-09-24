import {
  addDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { adapterFor } from "@/lib/biometric-adapters";
import { db } from "@/lib/firebase";
import type { BiometricCommand, BiometricDevice } from "@/types/models";
import { col, COLLECTIONS, subscribeCollection, subscribeQuery, toDate } from "./firestore.service";

export type DeviceInput = Omit<
  BiometricDevice,
  "id" | "createdAt" | "updatedAt" | "lastSyncAt" | "lastSeenAt"
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

/** ADMS devices poll every ~10 s; no contact for 3 minutes means the device is offline. */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

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
