/**
 * The old gym software's data (Backup page). The original export files are kept byte for byte
 * (base64 pieces under /oldDataFiles/{id}/chunks, with a SHA-256 to prove nothing changed), and
 * one record per phone is built from the latest Customer + Subscription reports into
 * /oldMembers/{phone} plus a compact list in /oldDataIndex. Firestore rules close all of it to
 * the browser: everything goes through here, with these checks:
 *
 *   POST /api/old-data/upload     owners: save files, rebuild the records
 *   POST /api/old-data/sync       owners: link the records to members already in the app
 *   GET  /api/old-data/files      "Backup": the saved files and what was read from them
 *   GET  /api/old-data/download   "Backup": one original file (logged)
 *   GET  /api/old-data/directory  "Backup": every old member, one line each
 *   GET  /api/old-data/member     "Members": the old record(s) of one phone number
 *   GET  /api/old-data/suspects   Income & expenses: sales that look paid in the old software
 */
import { createHash } from "node:crypto";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { isOwnerEmail } from "@/constants/owners";
import type { PortalOldPlan } from "@/constants/portal";
import {
  buildOldMembers,
  detectKind,
  directoryEntry,
  oldJoinedOn,
  oldPhoneKey,
  parseCsv,
  pickOldMember,
  type OldDirectoryEntry,
  type OldFileKind,
  type OldMember,
} from "@/lib/old-data";
import { db, json, localDate, requireFeature, requireStaff, text } from "./admin";
import { oldSaleSuspects } from "./old-sales";

const FILES = "oldDataFiles";
const MEMBERS = "oldMembers";
const INDEX = "oldDataIndex";
/** base64 characters per piece (Firestore documents hold up to 1 MiB). */
const CHUNK = 700_000;
/** Directory lines per document. */
const DIR_PART = 2000;
/** Total upload per request (Vercel accepts bodies up to 4.5 MB). */
const MAX_BASE64 = 4_000_000;

type Actor = { uid: string; name: string };
const actorOf = (u: { uid: string; email?: string | undefined; name?: unknown }) => ({
  uid: u.uid,
  name: String(u.name ?? "") || u.email || "Staff",
});

async function audit(actor: Actor, summary: string, docId = "backup") {
  await db()
    .collection("auditLogs")
    .add({
      at: FieldValue.serverTimestamp(),
      action: "updated",
      clientId: "",
      clientName: "",
      collection: FILES,
      docId,
      summary,
      actorType: "app_user",
      actorUid: actor.uid,
      actorName: actor.name,
      changes: {},
    })
    .catch((e) => console.error("audit write failed", String(e)));
}

async function owner(request: Request) {
  const user = await requireStaff(request);
  return user && isOwnerEmail(user.email) ? user : null;
}

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

const metaOf = (id: string, d: DocumentData): OldFileMeta => ({
  id,
  name: String(d["name"] ?? ""),
  kind: (d["kind"] as OldFileKind) ?? "other",
  contentType: String(d["contentType"] ?? "application/octet-stream"),
  size: Number(d["size"] ?? 0),
  sha256: String(d["sha256"] ?? ""),
  rows: Number(d["rows"] ?? 0),
  chunks: Number(d["chunks"] ?? 0),
  uploadedAt:
    (d["uploadedAt"] as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? "",
  uploadedBy: String(d["uploadedBy"] ?? ""),
});

/** A saved file's original bytes, checked against its SHA-256. */
async function fileBytes(id: string, meta: OldFileMeta) {
  const parts = await db().collection(`${FILES}/${id}/chunks`).orderBy("i").get();
  const buf = Buffer.from(parts.docs.map((p) => String(p.data()["data"] ?? "")).join(""), "base64");
  const sha = createHash("sha256").update(buf).digest("hex");
  if (parts.size !== meta.chunks || sha !== meta.sha256)
    throw new Error(`The saved copy of ${meta.name} is incomplete (checksum does not match).`);
  return buf;
}

async function listFiles() {
  const snap = await db().collection(FILES).orderBy("uploadedAt", "desc").get();
  return snap.docs.map((d) => metaOf(d.id, d.data()));
}

/**
 * Rebuilds /oldMembers and /oldDataIndex from the newest Customer and Subscription reports.
 * Records of phones no longer in the files are removed.
 */
async function rebuild() {
  const files = await listFiles();
  const latest = (k: OldFileKind) => files.find((f) => f.kind === k) ?? null;
  const cust = latest("customers");
  const subs = latest("subscriptions");
  const [custText, subsText] = await Promise.all([
    cust ? fileBytes(cust.id, cust).then((b) => b.toString("utf8")) : "",
    subs ? fileBytes(subs.id, subs).then((b) => b.toString("utf8")) : "",
  ]);
  const byPhone = buildOldMembers(custText, subsText);
  const firestore = db();
  const summaryRef = firestore.doc(`${INDEX}/summary`);
  const before = (await summaryRef.get()).data() ?? {};
  const oldKeys = new Set<string>(
    Array.isArray(before["keys"]) ? (before["keys"] as string[]) : [],
  );
  const writer = firestore.bulkWriter();
  const now = FieldValue.serverTimestamp();
  const entries: OldDirectoryEntry[] = [];
  for (const [key, members] of byPhone) {
    oldKeys.delete(key);
    writer.set(firestore.doc(`${MEMBERS}/${key}`), { key, members, updatedAt: now });
    members.forEach((m) => entries.push(directoryEntry(key, m)));
  }
  oldKeys.forEach((k) => writer.delete(firestore.doc(`${MEMBERS}/${k}`)));
  const parts = Math.max(1, Math.ceil(entries.length / DIR_PART));
  for (let i = 0; i < parts; i++)
    writer.set(firestore.doc(`${INDEX}/dir-${i}`), {
      entries: entries.slice(i * DIR_PART, (i + 1) * DIR_PART),
      updatedAt: now,
    });
  for (let i = parts; i < Number(before["parts"] ?? 0); i++)
    writer.delete(firestore.doc(`${INDEX}/dir-${i}`));
  const plans = entries.reduce((t, e) => t + e.c, 0);
  writer.set(summaryRef, {
    keys: [...byPhone.keys()],
    parts,
    members: entries.length,
    phones: byPhone.size,
    plans,
    customersFile: cust?.id ?? "",
    subscriptionsFile: subs?.id ?? "",
    builtAt: now,
  });
  await writer.close();
  return { members: entries.length, phones: byPhone.size, plans };
}

interface UploadFile {
  name?: unknown;
  type?: unknown;
  base64?: unknown;
}

async function upload(request: Request) {
  const user = await owner(request);
  if (!user) return json({ error: "Only the owner can add old software data." }, 403);
  const body = (await request.json().catch(() => ({}))) as { files?: UploadFile[] };
  const files = Array.isArray(body.files) ? body.files.slice(0, 10) : [];
  if (!files.length) return json({ error: "Choose the exported files first." }, 400);
  const total = files.reduce((t, f) => t + String(f.base64 ?? "").length, 0);
  if (total > MAX_BASE64)
    return json({ error: "Too big for one upload: add the files one at a time." }, 413);
  const actor = actorOf(user);
  const existing = await listFiles();
  const firestore = db();
  const saved: { name: string; kind: OldFileKind; rows: number }[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const name =
      String(f.name ?? "file")
        .replace(/[\\/]/g, "_")
        .slice(0, 160) || "file";
    const b64 = String(f.base64 ?? "");
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) {
      skipped.push(`${name} (empty)`);
      continue;
    }
    const sha256 = createHash("sha256").update(buf).digest("hex");
    if (existing.some((e) => e.sha256 === sha256)) {
      skipped.push(`${name} (already saved)`);
      continue;
    }
    const isText = /\.(csv|txt)$/i.test(name) || /^text\//.test(String(f.type ?? ""));
    const textBody = isText ? buf.toString("utf8") : "";
    const kind = isText ? detectKind(textBody) : "other";
    const rows = isText ? Math.max(0, parseCsv(textBody).length - 1) : 0;
    const exact = buf.toString("base64");
    const pieces = Math.ceil(exact.length / CHUNK);
    const ref = firestore.collection(FILES).doc(`${Date.now()}-${sha256.slice(0, 12)}`);
    const batch = firestore.batch();
    for (let i = 0; i < pieces; i++)
      batch.set(ref.collection("chunks").doc(String(i).padStart(4, "0")), {
        i,
        data: exact.slice(i * CHUNK, (i + 1) * CHUNK),
      });
    // The file's details last, so a half-saved file is never listed.
    await batch.commit();
    await ref.set({
      name,
      kind,
      contentType: String(f.type ?? "") || (isText ? "text/csv" : "application/octet-stream"),
      size: buf.length,
      sha256,
      rows,
      chunks: pieces,
      uploadedAt: FieldValue.serverTimestamp(),
      uploadedBy: actor.name,
      uploadedByUid: actor.uid,
    });
    saved.push({ name, kind, rows });
    await audit(actor, `Saved old software data: ${name} (${rows} rows)`, ref.id);
  }
  const index = saved.some((s) => s.kind !== "other") ? await rebuild() : null;
  return json({ saved, skipped, index });
}

async function files(request: Request) {
  if (!(await requireFeature(request, "backup")))
    return json({ error: "This login can't open Backup." }, 403);
  const [list, summary] = await Promise.all([listFiles(), db().doc(`${INDEX}/summary`).get()]);
  const s = summary.data();
  return json({
    files: list,
    index: s
      ? {
          members: Number(s["members"] ?? 0),
          phones: Number(s["phones"] ?? 0),
          plans: Number(s["plans"] ?? 0),
          customersFile: String(s["customersFile"] ?? ""),
          subscriptionsFile: String(s["subscriptionsFile"] ?? ""),
          builtAt:
            (s["builtAt"] as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? "",
        }
      : null,
  });
}

async function download(request: Request, url: URL) {
  const user = await requireFeature(request, "backup");
  if (!user) return json({ error: "This login can't download the backup." }, 403);
  const id = url.searchParams.get("id") ?? "";
  const snap = await db().doc(`${FILES}/${id}`).get();
  if (!snap.exists) return json({ error: "File not found." }, 404);
  const meta = metaOf(snap.id, snap.data()!);
  const buf = await fileBytes(id, meta);
  await audit(actorOf(user), `Downloaded old software data: ${meta.name}`, id);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": meta.contentType,
      "content-length": String(buf.length),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      "x-content-sha256": meta.sha256,
      "cache-control": "no-store",
    },
  });
}

async function readDirectory() {
  const summary = (await db().doc(`${INDEX}/summary`).get()).data();
  const parts = Number(summary?.["parts"] ?? 0);
  const docs = await Promise.all(
    Array.from({ length: parts }, (_, i) => db().doc(`${INDEX}/dir-${i}`).get()),
  );
  return docs.flatMap((d) => (d.data()?.["entries"] as OldDirectoryEntry[] | undefined) ?? []);
}

async function directory(request: Request) {
  if (!(await requireFeature(request, "backup")))
    return json({ error: "This login can't open Backup." }, 403);
  return json({ entries: await readDirectory(), today: localDate() });
}

async function member(request: Request, url: URL) {
  if (!(await requireFeature(request, "members")))
    return json({ error: "This login can't look up members." }, 403);
  const key = oldPhoneKey(url.searchParams.get("phone") ?? "");
  if (key.length < 6) return json({ members: [] });
  const snap = await db().doc(`${MEMBERS}/${key}`).get();
  return json({
    members: (snap.data()?.["members"] as OldMember[] | undefined) ?? [],
    today: localDate(),
  });
}

/**
 * Members already added in the app get their old record linked by phone: the old member ID, and,
 * where the app has nothing yet, the joining date, date of birth and gender.
 */
async function sync(request: Request) {
  const user = await owner(request);
  if (!user) return json({ error: "Only the owner can link the old data." }, 403);
  const entries = await readDirectory();
  if (!entries.length) return json({ error: "Add the old software's files first." }, 400);
  const byKey = new Map<string, OldDirectoryEntry[]>();
  entries.forEach((e) => byKey.set(e.k, [...(byKey.get(e.k) ?? []), e]));
  const firestore = db();
  const clients = await firestore.collection("clients").get();
  const writer = firestore.bulkWriter();
  let linked = 0,
    unclear = 0,
    notFound = 0,
    already = 0,
    joined = 0;
  for (const doc of clients.docs) {
    const c = doc.data();
    const key = oldPhoneKey(String(c["phoneNormalized"] ?? c["phone"] ?? ""));
    const found = byKey.get(key) ?? [];
    if (!found.length) {
      notFound++;
      continue;
    }
    const e = c["oldMemberId"]
      ? (found.find((x) => x.id === c["oldMemberId"]) ?? null)
      : pickOldMember(found, String(c["fullName"] ?? ""));
    if (!e) {
      unclear++;
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (!c["oldMemberId"]) patch["oldMemberId"] = e.id;
    if (!c["joinedOn"] && e.r) {
      const created = (c["createdAt"] as { toDate?: () => Date } | undefined)?.toDate?.();
      if (!created || e.r < localDate(created)) {
        patch["joinedOn"] = e.r;
        joined++;
      }
    }
    if (!c["dateOfBirth"] && e.d) patch["dateOfBirth"] = e.d;
    if ((!c["gender"] || c["gender"] === "unspecified") && e.g !== "unspecified")
      patch["gender"] = e.g;
    if (!Object.keys(patch).length) {
      already++;
      continue;
    }
    writer.update(doc.ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    linked++;
  }
  await writer.close();
  await audit(
    actorOf(user),
    `Linked old software data to ${linked} member${linked === 1 ? "" : "s"} (${joined} joining dates set)`,
  );
  return json({ linked, joined, unclear, notFound, already, members: clients.size });
}

/**
 * Old record for the member app: only once staff (or "Link old data") tied this member to their
 * old member ID, and only that one (never another family member on the same phone).
 */
export async function oldHistoryFor(c: DocumentData) {
  const key = oldPhoneKey(String(c["phoneNormalized"] ?? c["phone"] ?? ""));
  const id = String(c["oldMemberId"] ?? "");
  if (key.length < 6 || !id) return null;
  const records =
    ((await db().doc(`${MEMBERS}/${key}`).get()).data()?.["members"] as OldMember[] | undefined) ??
    [];
  const m = records.find((r) => r.memberId === id) ?? null;
  if (!m) return null;
  // Only what the member needs: no staff names or internal remarks.
  const plans: PortalOldPlan[] = m.plans.map((p) => ({
    name: p.name,
    start: p.start,
    end: p.end,
    price: p.price,
    discount: p.discount,
    amount: p.amount,
    paid: Math.max(0, p.amount - Math.max(0, p.balance)),
    balance: Math.max(0, p.balance),
    bill: p.bill,
    status: p.status,
  }));
  return { memberId: m.memberId, joinedOn: oldJoinedOn(m), plans };
}

/** Member calls key of one old member (one phone can hold a family). */
const oldCallKey = (k: string, id: string) => `old_${k}_${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/**
 * Puts old members on the Member calls page ("Old software"), with their whole old record, so
 * the front desk can phone the ones who have not come back. Given entries = those people;
 * none = everyone whose old plan runs today and who has no thumb in the app yet. Someone
 * already on the list keeps their call status and notes.
 */
async function callList(request: Request) {
  const user =
    (await requireFeature(request, "memberCalls")) ?? (await requireFeature(request, "backup"));
  if (!user) return json({ error: "This login can't use Member calls." }, 403);
  const body = (await request.json().catch(() => ({}))) as {
    entries?: { k?: unknown; id?: unknown }[];
  };
  const today = localDate();
  let wanted: { k: string; id: string }[];
  if (Array.isArray(body.entries)) {
    wanted = body.entries
      .map((e) => ({ k: oldPhoneKey(String(e.k ?? "")), id: String(e.id ?? "") }))
      .filter((e) => e.k.length >= 6 && e.id);
  } else {
    const back = await db().collection("clients").where("firstThumbRegistered", "==", true).get();
    const ids = new Set(back.docs.map((d) => String(d.data()["oldMemberId"] ?? "")));
    const phones = new Set(
      back.docs.map((d) =>
        oldPhoneKey(String(d.data()["phoneNormalized"] ?? d.data()["phone"] ?? "")),
      ),
    );
    wanted = (await readDirectory())
      .filter((e) => !!e.pe && e.pe >= today && e.ps <= today && !/inactive/i.test(e.st))
      .filter((e) => !ids.has(e.id) && !phones.has(e.k))
      .map((e) => ({ k: e.k, id: e.id }));
  }
  wanted = wanted.slice(0, 2000);
  const refs = wanted.map((e) => db().doc(`memberCalls/${oldCallKey(e.k, e.id)}`));
  const [records, existing] = await Promise.all([
    refs.length
      ? db().getAll(...[...new Set(wanted.map((e) => e.k))].map((k) => db().doc(`${MEMBERS}/${k}`)))
      : Promise.resolve([]),
    refs.length ? db().getAll(...refs) : Promise.resolve([]),
  ]);
  const byPhone = new Map(
    records.map((r) => [r.id, (r.data()?.["members"] as OldMember[] | undefined) ?? []]),
  );
  const had = new Set(existing.filter((d) => d.exists).map((d) => d.id));
  const actor = actorOf(user);
  const writer = db().bulkWriter();
  let added = 0;
  let already = 0;
  wanted.forEach((e, i) => {
    const m = byPhone.get(e.k)?.find((r) => r.memberId === e.id);
    const ref = refs[i]!;
    if (!m) return;
    if (had.has(ref.id)) {
      already += 1;
      return;
    }
    had.add(ref.id);
    added += 1;
    void writer.set(ref, {
      segment: "old",
      clientId: "",
      clientNameSnapshot: m.name,
      phoneSnapshot: m.phone || e.k,
      phoneKey: e.k,
      oldMemberId: m.memberId,
      old: m,
      status: "not_called",
      notes: "",
      addedBy: actor.name,
      addedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.name,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await writer.close();
  if (added)
    await audit(actor, `Put ${added} old member${added === 1 ? "" : "s"} on the call list`);
  return json({ added, already });
}

export async function handleOldData(request: Request, url: URL): Promise<Response> {
  const action = url.pathname.replace(/^\/api\/old-data\/?/, "").replace(/\/+$/, "");
  if (request.method === "POST" && action === "upload") return upload(request);
  if (request.method === "POST" && action === "sync") return sync(request);
  if (request.method === "POST" && action === "call-list") return callList(request);
  if (request.method === "GET" && action === "files") return files(request);
  if (request.method === "GET" && action === "download") return download(request, url);
  if (request.method === "GET" && action === "directory") return directory(request);
  if (request.method === "GET" && action === "member") return member(request, url);
  if (request.method === "GET" && action === "suspects") return oldSaleSuspects(request);
  return text("Not found", 404);
}
