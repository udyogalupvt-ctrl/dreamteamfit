import {
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { callServer } from "@/lib/server-api";
import {
  cfoListDocId,
  CFO_BRIEF_LATEST_DOC,
  CFO_BRIEF_STATUS_DOC,
  CFO_REPORT_DOC,
  CFO_SETTINGS_DOC,
  DEFAULT_CFO_SETTINGS,
  type CfoAlertRow,
  type CfoBrief,
  type CfoBriefAttempt,
  type CfoBriefStatus,
  type CfoDueRow,
  type CfoLanguage,
  type CfoListDoc,
  type CfoListKey,
  type CfoReportMeta,
  type CfoSettings,
  type CfoSnapshot,
} from "@/lib/cfo/types";
import { formatDay } from "@/lib/cfo/money";
import { todayISO } from "@/lib/format";
import { COLLECTIONS, col } from "./firestore.service";

/** `cfoReports/latest`: the numbers plus the server's lock fields. */
export type CfoReportDoc = CfoSnapshot & Partial<CfoReportMeta>;

/** One watched document: missing = `value` null; `denied` = the database rules say no (yet). */
export interface CfoDocState<T> {
  value: T | null;
  denied: boolean;
}

export const CFO_LOADING: CfoDocState<never> = { value: null, denied: false };

/** Wait this long before asking again after the rules refused a read (they may be deployed soon). */
const DENIED_RETRY_MS = 60_000;

/**
 * Watches one CFO document. A refused read ("permission-denied", which is what happens before
 * the rules are deployed) is reported as `denied` and tried again once a minute, quietly, instead
 * of the page's usual fast retries.
 */
function watchDoc<T>(
  collectionName: "cfoSettings" | "cfoReports" | "cfoBriefs",
  id: string,
  map: (d: DocumentData) => T,
  onData: (s: CfoDocState<T>) => void,
  onError: (e: Error) => void,
) {
  let stop: () => void = () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const start = () => {
    stop = onSnapshot(
      doc(db, collectionName, id),
      (snap) => onData({ value: snap.exists() ? map(snap.data()) : null, denied: false }),
      (err) => {
        if ((err as { code?: string }).code === "permission-denied") {
          onData({ value: null, denied: true });
          if (!closed) timer = setTimeout(start, DENIED_RETRY_MS);
        } else onError(err);
      },
    );
  };
  start();
  return () => {
    closed = true;
    clearTimeout(timer);
    stop();
  };
}

const asIs = <T>(d: DocumentData) => d as unknown as T;

export const subscribeCfoReport = (
  onData: (s: CfoDocState<CfoReportDoc>) => void,
  onError: (e: Error) => void,
) => watchDoc(COLLECTIONS.cfoReports, CFO_REPORT_DOC, asIs<CfoReportDoc>, onData, onError);

export const subscribeCfoBrief = (
  onData: (s: CfoDocState<CfoBrief>) => void,
  onError: (e: Error) => void,
) => watchDoc(COLLECTIONS.cfoBriefs, CFO_BRIEF_LATEST_DOC, asIs<CfoBrief>, onData, onError);

export const subscribeCfoBriefStatus = (
  onData: (s: CfoDocState<CfoBriefAttempt>) => void,
  onError: (e: Error) => void,
) => watchDoc(COLLECTIONS.cfoBriefs, CFO_BRIEF_STATUS_DOC, asIs<CfoBriefAttempt>, onData, onError);

const LANGUAGES: CfoLanguage[] = ["English", "Telugu", "Hindi"];

/** Settings with the defaults filled in for anything missing or the wrong type. */
export function mapCfoSettings(d: DocumentData): CfoSettings {
  const base = DEFAULT_CFO_SETTINGS;
  const n = (k: keyof CfoSettings, fallback: number) =>
    typeof d[k] === "number" && Number.isFinite(d[k]) ? (d[k] as number) : fallback;
  const language = LANGUAGES.find((l) => l === d["language"]) ?? base.language;
  return {
    openingBalance:
      typeof d["openingBalance"] === "number" && Number.isFinite(d["openingBalance"])
        ? d["openingBalance"]
        : null,
    openingDate: typeof d["openingDate"] === "string" ? d["openingDate"] : "",
    atRiskDays: n("atRiskDays", base.atRiskDays),
    renewalDays: n("renewalDays", base.renewalDays),
    newMemberMinVisits: n("newMemberMinVisits", base.newMemberMinVisits),
    ptMinVisits: n("ptMinVisits", base.ptMinVisits),
    runwayWarnMonths: n("runwayWarnMonths", base.runwayWarnMonths),
    graceDays: n("graceDays", base.graceDays),
    aiEnabled: d["aiEnabled"] !== false,
    language,
  };
}

export const subscribeCfoSettings = (
  onData: (s: CfoDocState<CfoSettings>) => void,
  onError: (e: Error) => void,
) => watchDoc(COLLECTIONS.cfoSettings, CFO_SETTINGS_DOC, mapCfoSettings, onData, onError);

/** The full list behind a tab. One read, only when the tab (or its Excel / Print) is opened. */
export async function getCfoList<Row>(key: CfoListKey): Promise<CfoListDoc<Row> | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.cfoReports, cfoListDocId(key)));
  return snap.exists() ? (snap.data() as unknown as CfoListDoc<Row>) : null;
}

/** Saves the settings (the activity log gets a line without the amounts). */
export async function saveCfoSettings(settings: CfoSettings, by: string) {
  await setDoc(
    doc(db, COLLECTIONS.cfoSettings, CFO_SETTINGS_DOC),
    { ...settings, updatedAt: serverTimestamp(), updatedBy: by },
    { merge: true },
  );
}

/* ------------------------------------------------------------------ server calls */

export interface CfoRefreshResult {
  ok: true;
  computedAt: string;
  nextRefreshAt: string;
}

export interface CfoBriefResult {
  ok: true;
  status: CfoBriefStatus;
  reason: string;
}

const STILL_WORKING = "Still working it out. Try again in 2 minutes.";

/** Plain words for a failed server call (a timeout or crash comes back as a non-JSON page). */
export function cfoErrorMessage(e: unknown) {
  const message = e instanceof Error ? e.message : "";
  if (!message) return STILL_WORKING;
  if (/^Server error (5\d\d)$/.test(message) || /server is not set up yet/i.test(message))
    return STILL_WORKING;
  if (/failed to fetch|networkerror|load failed/i.test(message))
    return "Can't reach the server. Check your connection and try again.";
  return message;
}

export const refreshCfo = () => callServer<CfoRefreshResult>("/api/cfo/refresh", {});
export const requestCfoBrief = () => callServer<CfoBriefResult>("/api/cfo/brief", {});

/* ------------------------------------------------------------- check before messaging */

export interface RowCheck {
  /** Set when the row is out of date: shown to the user instead of opening WhatsApp. */
  stale: string | null;
  /** Dues only: the balance right now. */
  balance?: number;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || "This member";

/**
 * Right before a WhatsApp chat opens: one or two reads to see if the row is still true (the
 * numbers are from this morning or the last Refresh). Any read that fails counts as "no news",
 * so a login that can't read that record still gets its chat.
 */
export async function recheckCfoRow(
  key: CfoListKey,
  row: CfoAlertRow | CfoDueRow,
): Promise<RowCheck> {
  try {
    const today = todayISO();
    if (key === "dues") {
      const r = row as CfoDueRow;
      const snap = await getDoc(doc(db, COLLECTIONS.invoices, r.billId));
      if (!snap.exists()) return { stale: null };
      const d = snap.data();
      const balance = Number(d["balanceDue"] ?? 0);
      const status = String(d["paymentStatus"] ?? "");
      if (balance <= 0 || status === "refunded" || status === "closed")
        return {
          stale: `${first(r.name)} has already paid bill ${r.billNumber}. Nothing is pending now.`,
        };
      return { stale: null, balance };
    }
    const r = row as CfoAlertRow;
    if (key === "ptChances") {
      const snap = await getDocs(
        query(col(COLLECTIONS.ptAssignments), where("clientId", "==", r.clientId)),
      );
      if (snap.docs.some((x) => x.data()["status"] !== "cancelled"))
        return { stale: `${first(r.name)} has a personal training plan now.` };
      return { stale: null };
    }
    const snap = await getDoc(doc(db, COLLECTIONS.clients, r.clientId));
    if (!snap.exists()) return { stale: null };
    const d = snap.data();
    const lastVisit = String(d["lastVisitDate"] ?? "");
    if (key === "renewals") {
      const cm = d["currentMembership"] as { endDate?: string } | null | undefined;
      if (cm?.endDate && r.endDate && cm.endDate > r.endDate)
        return {
          stale: `${first(r.name)} has already renewed. The plan now runs till ${formatDay(cm.endDate)}.`,
        };
      return { stale: null };
    }
    if (key === "atRisk") {
      if (lastVisit && lastVisit > r.lastVisit)
        return {
          stale: `${first(r.name)} came to the gym ${lastVisit === today ? "today" : `on ${formatDay(lastVisit)}`}. No need to message.`,
        };
      return { stale: null };
    }
    // New members slipping.
    if (lastVisit === today) return { stale: `${first(r.name)} came to the gym today.` };
    return { stale: null };
  } catch {
    return { stale: null };
  }
}
