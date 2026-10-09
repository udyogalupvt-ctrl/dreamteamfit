/**
 * The old gym software's exports (Customer Report and Subscription Report CSVs), read into one
 * record per phone number. The server keeps the original files byte for byte (Backup page) and
 * builds these records from them; the joining form, the member's profile and the member app show
 * them. Pure functions: used by the server and by tests.
 */

export type OldFileKind = "customers" | "subscriptions" | "other";

/** One plan in the old software (a row of the Subscription Report). */
export interface OldPlan {
  name: string;
  /** "Membership Cost", "Discount", "Amount to be paid", "Balance Amount", as exported. */
  price: number;
  discount: number;
  amount: number;
  balance: number;
  start: string;
  end: string;
  /** Date the balance was promised for, "" when none. */
  nextPayment: string;
  status: string;
  counsellor: string;
  createdBy: string;
  /** Bill number taken from the remark ("BILL NO :- 344" → "344"). */
  bill: string;
  remark: string;
}

/** One member in the old software, with all their plans (newest first). */
export interface OldMember {
  memberId: string;
  name: string;
  phone: string;
  gender: "male" | "female" | "unspecified";
  /** "YYYY-MM-DD", "" when unknown. */
  dob: string;
  married: string;
  anniversary: string;
  counsellor: string;
  email: string;
  address: string;
  remark: string;
  status: string;
  /** Day they first joined in the old software ("Registration Date"). */
  registeredOn: string;
  plans: OldPlan[];
}

/** Compact line per old member for the Backup page lists (one document holds them all). */
export interface OldDirectoryEntry {
  /** Phone key (the record's document ID). */
  k: string;
  id: string;
  n: string;
  st: string;
  /** Joined the gym (see oldJoinedOn). */
  r: string;
  g: OldMember["gender"];
  d: string;
  /** Latest plan: name, start, end, balance. */
  p: string;
  ps: string;
  pe: string;
  b: number;
  /** Number of plans. */
  c: number;
}

/** "+91 98765-43210" → "9876543210" (the same key the app uses for members' phones). */
export function oldPhoneKey(phone: string) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** RFC 4180 CSV: quoted fields, "" inside quotes, CRLF / LF, a UTF-8 byte-order mark. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Rows as objects keyed by normalised header ("member id", "first name", …). */
export function csvObjects(text: string) {
  const [head, ...rest] = parseCsv(text);
  const keys = (head ?? []).map(norm);
  return {
    headers: (head ?? []).map((h) => h.trim()),
    rows: rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()]))),
  };
}

/** Which export a file is, from its header line. */
export function detectKind(text: string): OldFileKind {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const h = parseCsv(first)[0]?.map(norm) ?? [];
  if (h.includes("membership name") && (h.includes("contact") || h.includes("member id")))
    return "subscriptions";
  if (h.includes("first name") && (h.includes("contact") || h.includes("member id")))
    return "customers";
  return "other";
}

/** "2026-10-01", "01-10-2026", "01/10/2026" → "2026-10-01"; "0000-00-00", "N.A", junk → "". */
export function oldDate(value: string) {
  const v = String(value ?? "").trim();
  let y = 0,
    m = 0,
    d = 0;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else if ((hit = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(v)))
    [d, m, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else return "";
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const money = (v: string) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const clean = (v: string) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
const na = (v: string) => (/^(n\.?a\.?|null|-)$/i.test(clean(v)) ? "" : clean(v));
const gender = (v: string): OldMember["gender"] =>
  /^m/i.test(v.trim()) ? "male" : /^f/i.test(v.trim()) ? "female" : "unspecified";
const billOf = (remark: string) => /bill\s*no\s*[:\-–]*\s*([\w/-]+)/i.exec(remark)?.[1] ?? "";

/** "roshan roshan" → "Roshan Roshan"; names already in capitals or mixed case stay as they are. */
export function tidyName(name: string) {
  return clean(name)
    .split(" ")
    .map((w) => (w && w === w.toLowerCase() ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function planOf(r: Record<string, string>): OldPlan {
  const remark = clean(r["remark"] ?? "");
  return {
    name: clean(r["membership name"] ?? ""),
    price: money(r["membership cost"] ?? ""),
    discount: money(r["discount"] ?? ""),
    amount: money(r["amount to be paid"] ?? ""),
    balance: money(r["balance amount"] ?? ""),
    start: oldDate(r["start date"] ?? ""),
    end: oldDate(r["expires on"] ?? ""),
    nextPayment: oldDate(r["next payment"] ?? ""),
    status: na(r["status"] ?? ""),
    counsellor: na(r["councellor"] ?? r["counsellor"] ?? ""),
    createdBy: na(r["createdby"] ?? r["created by"] ?? ""),
    bill: billOf(remark),
    remark,
  };
}

/**
 * One record per phone (a phone can belong to more than one old member, e.g. family) from the
 * two exports. Members only in the Subscription Report still get a record.
 */
export function buildOldMembers(customersCsv: string, subscriptionsCsv: string) {
  const customers = customersCsv ? csvObjects(customersCsv).rows : [];
  const subs = subscriptionsCsv ? csvObjects(subscriptionsCsv).rows : [];
  const byId = new Map<string, OldMember>();
  const blank = (memberId: string, name: string, phone: string): OldMember => ({
    memberId,
    name,
    phone,
    gender: "unspecified",
    dob: "",
    married: "",
    anniversary: "",
    counsellor: "",
    email: "",
    address: "",
    remark: "",
    status: "",
    registeredOn: "",
    plans: [],
  });
  for (const r of customers) {
    const id = clean(r["member id"] ?? "");
    const name = clean(`${r["first name"] ?? ""} ${r["last name"] ?? ""}`);
    const phone = clean(r["contact"] ?? "");
    if (!id && !phone) continue;
    const m = blank(id, name, phone);
    m.gender = gender(r["gender"] ?? "");
    m.dob = oldDate(r["date of birth"] ?? "");
    m.married = /^unspec/i.test(r["married status"] ?? "") ? "" : na(r["married status"] ?? "");
    m.anniversary = oldDate(r["anniversary date"] ?? "");
    m.counsellor = na(r["councellor"] ?? r["counsellor"] ?? "");
    m.email = clean(r["email"] ?? "");
    m.address = clean(r["address"] ?? "");
    m.remark = clean(r["remark"] ?? "");
    m.status = na(r["status"] ?? "");
    m.registeredOn = oldDate(r["registration date"] ?? "");
    byId.set(id || `phone:${oldPhoneKey(phone)}`, m);
  }
  for (const r of subs) {
    const id = clean(r["member id"] ?? "");
    const phone = clean(r["contact"] ?? "");
    const key = id || `phone:${oldPhoneKey(phone)}`;
    let m = byId.get(key);
    if (!m) {
      m = blank(id, clean(r["member name"] ?? ""), phone);
      m.gender = gender(r["gender"] ?? "");
      byId.set(key, m);
    }
    m.plans.push(planOf(r));
  }
  const byPhone = new Map<string, OldMember[]>();
  for (const m of byId.values()) {
    m.plans.sort((a, b) => b.start.localeCompare(a.start) || b.end.localeCompare(a.end));
    // Joined in the old software before the first plan when the registration date is missing.
    if (!m.registeredOn) m.registeredOn = m.plans.at(-1)?.start ?? "";
    const k = oldPhoneKey(m.phone);
    if (!k) continue;
    byPhone.set(k, [...(byPhone.get(k) ?? []), m]);
  }
  return byPhone;
}

export function directoryEntry(key: string, m: OldMember): OldDirectoryEntry {
  const last = m.plans[0];
  return {
    k: key,
    id: m.memberId,
    n: m.name,
    st: m.status,
    r: oldJoinedOn(m),
    g: m.gender,
    d: m.dob,
    p: last?.name ?? "",
    ps: last?.start ?? "",
    pe: last?.end ?? "",
    b: last?.balance ?? 0,
    c: m.plans.length,
  };
}

/** The old member on a phone that matches this name best (family members can share a phone). */
export function pickOldMember<T extends { name?: string; n?: string }>(
  records: T[],
  name: string,
): T | null {
  if (records.length <= 1) return records[0] ?? null;
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1),
    );
  const want = words(name);
  const scored = records
    .map((r) => {
      const have = words(r.name ?? r.n ?? "");
      return { r, score: [...want].filter((w) => have.has(w)).length };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]!.score > 0 && scored[0]!.score > (scored[1]?.score ?? 0) ? scored[0]!.r : null;
}

/**
 * When they first joined the gym: the registration date, or the first plan's start when that is
 * earlier (the old software re-dated members it restored).
 */
export function oldJoinedOn(m: Pick<OldMember, "registeredOn" | "plans">) {
  const starts = [m.registeredOn, ...m.plans.map((p) => p.start)].filter(Boolean).sort();
  return starts[0] ?? "";
}

/**
 * The old software's plan that a plan here carries over: one that started within 10 days of it,
 * or ended within 10 days of it (nearest start first); null when none.
 */
export function matchingOldPlan(m: Pick<OldMember, "plans">, start: string, end: string) {
  const iso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const gap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  return (
    m.plans
      .filter(
        (p) =>
          iso(p.start) &&
          iso(p.end) &&
          ((iso(start) && gap(p.start, start) <= 10) || (iso(end) && gap(p.end, end) <= 10)),
      )
      .sort((a, b) => (iso(start) ? gap(a.start, start) - gap(b.start, start) : 0))[0] ?? null
  );
}

/** A personal-training plan in the old software ("1 month alt pt", "PERSONAL TRAINING DAILY"). */
export const isOldPtPlanName = (name: string) => /\bpt\b|personal\s*training/i.test(name);

/** The old plan still running on a day ("" end = unknown, not running). */
export const runningOldPlan = (m: Pick<OldMember, "plans">, today: string) =>
  m.plans.find((p) => p.end >= today && p.start <= today && !/inactive/i.test(p.status)) ?? null;

/** Who the counsellor was in the old software: of the running plan, else the latest, else the member's. */
export function oldCounsellorOf(m: Pick<OldMember, "plans" | "counsellor">, today: string) {
  return (
    runningOldPlan(m, today)?.counsellor ||
    m.plans.find((p) => p.counsellor)?.counsellor ||
    m.counsellor
  );
}

const nameWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);

/**
 * The staff member an old software name means, written differently ("M Keerthi" = "keerthi M",
 * "Abhilash Nambaru" = "N. Abhilash", "O PavanKumar" = "Pavan"); null when none or several fit.
 */
export function matchStaffName<T extends { name: string }>(staff: T[], name: string): T | null {
  const want = nameWords(name);
  if (!want.length) return null;
  const same = (a: string, b: string) =>
    a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
  const scored = staff
    .map((s) => {
      const have = nameWords(s.name);
      return { s, score: want.filter((w) => have.some((h) => same(w, h))).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score > (scored[1]?.score ?? 0) ? scored[0].s : null;
}

/** A sale here that looks like a plan paid in the old software (Income & expenses review). */
export interface OldSaleSuspect {
  /** gym = a gym plan's bill (PT on it moves with it); pt = a PT plan sold alone. */
  kind: "gym" | "pt";
  /** "" for a PT plan sold alone. */
  membershipId: string;
  /** Set only for a PT plan sold alone. */
  ptAssignmentId: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  plan: string;
  start: string;
  end: string;
  price: number;
  invoiceId: string;
  invoiceNumber: string;
  discount: number;
  billTotal: number;
  paidHere: number;
  paidOn: string[];
  createdBy: string;
  /** The old software's plan that covers this one, when the old data has it. */
  old: {
    memberId: string;
    plan: string;
    start: string;
    end: string;
    amount: number;
    paid: number;
    balance: number;
    bill: string;
  } | null;
  /** The member's old-software plan already in this app for the same days (usually a copy). */
  inApp: { name: string; start: string; end: string; paid: number } | null;
  /** Why it is on the list, in plain words. */
  reasons: string[];
  /** Strong = the old software has a paid plan for the same days. */
  strength: "strong" | "check";
}
