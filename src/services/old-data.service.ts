import { auth } from "@/lib/firebase";
import type { OldDirectoryEntry, OldFileKind, OldMember } from "@/lib/old-data";
import { oldPhoneKey } from "@/lib/old-data";
import { callServer, getServer } from "@/lib/server-api";

/** A file saved on the Backup page (the original export, kept byte for byte). */
export interface OldFileMeta {
  id: string;
  name: string;
  kind: OldFileKind;
  contentType: string;
  size: number;
  sha256: string;
  rows: number;
  chunks: number;
  uploadedAt: string;
  uploadedBy: string;
}

export interface OldDataIndex {
  members: number;
  phones: number;
  plans: number;
  customersFile: string;
  subscriptionsFile: string;
  builtAt: string;
}

export const OLD_KIND_LABELS: Record<OldFileKind, string> = {
  customers: "Customer report",
  subscriptions: "Subscription report",
  other: "Other file",
};

async function base64Of(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Owner: saves the old software's export files (CSV) and rebuilds the member records. */
export async function uploadOldData(files: File[]) {
  const payload = await Promise.all(
    files.map(async (f) => ({ name: f.name, type: f.type, base64: await base64Of(f) })),
  );
  return callServer<{
    saved: { name: string; kind: OldFileKind; rows: number }[];
    skipped: string[];
    index: { members: number; phones: number; plans: number } | null;
  }>("/api/old-data/upload", { files: payload });
}

export const listOldData = () =>
  getServer<{ files: OldFileMeta[]; index: OldDataIndex | null }>("/api/old-data/files");

export const oldDirectory = () =>
  getServer<{ entries: OldDirectoryEntry[]; today: string }>("/api/old-data/directory");

/**
 * Puts old members on Member calls → Old software. No entries = everyone whose old plan runs
 * today and who has no thumb in the app yet.
 */
export const addOldToCallList = (entries?: { k: string; id: string }[]) =>
  callServer<{ added: number; already: number }>(
    "/api/old-data/call-list",
    entries ? { entries } : {},
  );

/** Owner: links the old records to members already in the app (by phone). */
export const syncOldData = () =>
  callServer<{
    linked: number;
    joined: number;
    unclear: number;
    notFound: number;
    already: number;
    members: number;
  }>("/api/old-data/sync");

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Downloads the original file exactly as it was saved: the bytes are checked against the
 * SHA-256 taken when it was uploaded before the browser saves them.
 */
export async function downloadOldFile(meta: OldFileMeta) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Please sign in again.");
  const r = await fetch(`/api/old-data/download?id=${encodeURIComponent(meta.id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `Download failed (${r.status})`);
  }
  const buf = await r.arrayBuffer();
  if (hex(await crypto.subtle.digest("SHA-256", buf)) !== meta.sha256)
    throw new Error("The downloaded copy does not match the original. Try again.");
  const url = URL.createObjectURL(new Blob([buf], { type: meta.contentType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = meta.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const lookups = new Map<string, Promise<{ members: OldMember[]; today: string }>>();

/**
 * The old software's record(s) for a phone number (one read on the server). Kept for the visit,
 * so going back and forth in the joining form or the profile costs nothing more.
 */
export function lookupOldMembers(phone: string) {
  const key = oldPhoneKey(phone);
  if (key.length < 10) return Promise.resolve({ members: [] as OldMember[], today: "" });
  let p = lookups.get(key);
  if (!p) {
    p = getServer<{ members: OldMember[]; today: string }>(
      `/api/old-data/member?phone=${encodeURIComponent(key)}`,
    ).catch((e: unknown) => {
      lookups.delete(key);
      throw e;
    });
    lookups.set(key, p);
  }
  return p;
}
