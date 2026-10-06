/**
 * The CFO's server side (CFO_PLAN.md sections 5 and 6).
 *
 *   POST /api/cfo/refresh   work out the numbers now (at most once per 10 minutes, for everyone)
 *   POST /api/cfo/brief     write the AI summary from the saved numbers (3 presses a day)
 *
 * Both need a signed-in staff login with the Finance switch (401 / 403 otherwise) and always
 * answer in JSON. The numbers are saved before any AI call, so a broken AI never loses them.
 *
 * Docs: cfoReports/latest (numbers + lock), cfoReports/list-* (full lists), cfoBriefs/latest
 * (newest OK summary), cfoBriefs/status (last attempt), cfoBriefs/{date}-{HHmm} (history).
 * Only this server writes them (firestore.rules).
 */
import {
  CFO_BRIEF_LATEST_DOC,
  CFO_BRIEF_STATUS_DOC,
  CFO_COLLECTIONS,
  CFO_LANGUAGES,
  CFO_LIST_KEYS,
  CFO_MAX_MANUAL_BRIEFS_PER_DAY,
  CFO_MIN_REFRESH_SECONDS,
  CFO_REPORT_DOC,
  CFO_SETTINGS_DOC,
  DEFAULT_CFO_SETTINGS,
  cfoListDocId,
} from "@/lib/cfo/types";
import type {
  CfoAiStatus,
  CfoBrief,
  CfoBriefAttempt,
  CfoBriefStatus,
  CfoLanguage,
  CfoReportMeta,
  CfoSettings,
  CfoSnapshot,
  ISODate,
} from "@/lib/cfo/types";
import {
  briefPrivacyCheck,
  briefSystemPrompt,
  buildBriefInput,
  computeCfo,
  verifyBriefNumbers,
} from "@/lib/cfo/index";
import { attemptProblem } from "@/lib/cfo/ai-status";
import { db, json, localDate, requireFeature, requireStaff, TZ } from "./admin";
import { aiConfig, callAi, checkAi, onEmulator } from "./ai";
import { systemAudit } from "./audit";
import { loadCfoInput } from "./cfo-data";

type Row = Record<string, unknown>;

const reports = () => db().collection(CFO_COLLECTIONS.reports);
const briefs = () => db().collection(CFO_COLLECTIONS.briefs);
const reportRef = () => reports().doc(CFO_REPORT_DOC);

/** A request has this long in total (Vercel Hobby stops at 60 s). */
const REQUEST_MS = 50_000;
/** A lock older than this is a crashed run, not a running one. */
const LOCK_MS = 120_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------ test-only switches */

/** CFO_TODAY / CFO_MIN_REFRESH_SECONDS are honoured only against the local emulator. */
const testEnv = (name: string) => (onEmulator() ? (process.env[name] ?? "").trim() : "");

function today(): ISODate {
  const t = testEnv("CFO_TODAY");
  return ISO.test(t) ? t : localDate();
}

function minRefreshSeconds() {
  const raw = testEnv("CFO_MIN_REFRESH_SECONDS");
  const n = raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : CFO_MIN_REFRESH_SECONDS;
}

/* ----------------------------------------------------------------- small helpers */

const clock = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour12: false, ...opts }).format(d);
/** "10:15" in gym time. */
const hhmm = (iso: string) => clock(new Date(iso), { hour: "2-digit", minute: "2-digit" });
/** "1015" in gym time, for history doc ids. */
const hhmmCompact = (d: Date) => hhmm(d.toISOString()).replace(":", "");

const plusDays = (day: ISODate, n: number): ISODate => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The Monday of the week that `day` is in. */
const mondayOf = (day: ISODate): ISODate =>
  plusDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

/** Whatever Firestore must never see: undefined and NaN (JSON turns them into gone / null). */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Short error text for the log and the cron result: no member data, no secrets. */
const short = (e: unknown) =>
  String((e as Error)?.message ?? e)
    .replace(/\s+/g, " ")
    .slice(0, 100);

/* ------------------------------------------------------------------- settings */

const rec = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

/** cfoSettings/main merged over the defaults, field by field (an odd value falls back). */
export async function loadSettings(): Promise<CfoSettings> {
  const d = rec((await db().doc(`${CFO_COLLECTIONS.settings}/${CFO_SETTINGS_DOC}`).get()).data());
  const base = DEFAULT_CFO_SETTINGS;
  const count = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  const balance = d["openingBalance"];
  return {
    openingBalance: typeof balance === "number" && Number.isFinite(balance) ? balance : null,
    openingDate:
      typeof d["openingDate"] === "string" && ISO.test(d["openingDate"]) ? d["openingDate"] : "",
    atRiskDays: count(d["atRiskDays"], base.atRiskDays),
    renewalDays: count(d["renewalDays"], base.renewalDays),
    newMemberMinVisits: count(d["newMemberMinVisits"], base.newMemberMinVisits),
    ptMinVisits: count(d["ptMinVisits"], base.ptMinVisits),
    runwayWarnMonths: count(d["runwayWarnMonths"], base.runwayWarnMonths),
    graceDays: count(d["graceDays"], base.graceDays),
    aiEnabled: typeof d["aiEnabled"] === "boolean" ? d["aiEnabled"] : base.aiEnabled,
    language: CFO_LANGUAGES.includes(d["language"] as CfoLanguage)
      ? (d["language"] as CfoLanguage)
      : base.language,
  };
}

/* --------------------------------------------------------------------- refresh */

export type RefreshResult =
  | { ok: true; computedAt: string; nextRefreshAt: string; readCount: number }
  | { ok: false; kind: "busy" | "fresh"; error: string; nextRefreshAt: string };

/** One lock for everyone: a transaction on cfoReports/latest. */
async function takeLock(): Promise<RefreshResult | null> {
  const ref = reportRef();
  const minMs = minRefreshSeconds() * 1000;
  return db().runTransaction(async (tx) => {
    const d = rec((await tx.get(ref)).data());
    const now = Date.now();
    const running = typeof d["runningSince"] === "string" ? Date.parse(d["runningSince"]) : NaN;
    if (Number.isFinite(running) && now - running < LOCK_MS)
      return {
        ok: false,
        kind: "busy",
        error: "Already working it out. Try again in a minute.",
        nextRefreshAt: new Date(running + LOCK_MS).toISOString(),
      } satisfies RefreshResult;
    const at = typeof d["computedAt"] === "string" ? Date.parse(d["computedAt"]) : NaN;
    if (Number.isFinite(at) && now - at < minMs) {
      const next = new Date(at + minMs).toISOString();
      return {
        ok: false,
        kind: "fresh",
        error: `Worked out a few minutes ago. You can refresh again at ${hhmm(next)}.`,
        nextRefreshAt: next,
      } satisfies RefreshResult;
    }
    tx.set(ref, { runningSince: new Date(now).toISOString() }, { merge: true });
    return null;
  });
}

/** Lets go of the lock after a failed run (a doc that never held numbers is removed again). */
async function releaseLock() {
  const ref = reportRef();
  await db()
    .runTransaction(async (tx) => {
      const d = rec((await tx.get(ref)).data());
      if (typeof d["computedAt"] === "string") tx.update(ref, { runningSince: "" });
      else tx.delete(ref);
    })
    .catch((e) => console.error("cfo unlock failed", short(e)));
}

/**
 * Works out the numbers and saves them: the summary doc and the five full lists, in one
 * transaction (a reader never sees new numbers next to old lists).
 */
export async function refreshCfo(by: string, _deadline: number): Promise<RefreshResult> {
  const blocked = await takeLock();
  if (blocked) return blocked;
  try {
    const settings = await loadSettings();
    const day = today();
    const { input, readCount } = await loadCfoInput(settings, day);
    const computedAt = new Date().toISOString();
    const { snapshot, lists } = computeCfo(input, settings, { computedAt, computedBy: by });

    const ref = reportRef();
    await db().runTransaction(async (tx) => {
      // A summary request may have counted a press while we worked: keep its counter.
      const current = rec((await tx.get(ref)).data());
      const counter = rec(current["manualBriefs"]);
      const manualBriefs: CfoReportMeta["manualBriefs"] = {
        date: typeof counter["date"] === "string" ? counter["date"] : "",
        count: typeof counter["count"] === "number" ? counter["count"] : 0,
      };
      const nextRefreshAt = new Date(
        Date.parse(computedAt) + minRefreshSeconds() * 1000,
      ).toISOString();
      const meta: CfoReportMeta = { runningSince: "", readCount, manualBriefs, nextRefreshAt };
      tx.set(ref, clean({ ...snapshot, ...meta }));
      for (const key of CFO_LIST_KEYS) tx.set(reports().doc(cfoListDocId(key)), clean(lists[key]));
    });
    await systemAudit({
      collection: CFO_COLLECTIONS.reports,
      docId: CFO_REPORT_DOC,
      // The log line is written by the server, so it names who pressed Refresh in the text.
      summary:
        by === "Morning job" ? "CFO numbers worked out" : `CFO numbers worked out (by ${by})`,
    });
    return {
      ok: true,
      computedAt,
      nextRefreshAt: new Date(Date.parse(computedAt) + minRefreshSeconds() * 1000).toISOString(),
      readCount,
    };
  } catch (e) {
    await releaseLock();
    throw e;
  }
}

/* ----------------------------------------------------------------------- brief */

export type BriefResult =
  | { ok: true; status: CfoBriefStatus; reason: string }
  | { ok: false; http: 409 | 429; error: string };

const REMINDER =
  "\n\nImportant: copy every number exactly as it is written in the data (0-9 digits, the same ₹ format). " +
  "Do not round, convert, add up or work out any number yourself.";

/** Plain reasons the page shows next to "AI summary is not available right now." */
const REASON = {
  off: "switched off in CFO settings",
  notSetUp: "not set up yet",
  numbers: "couldn't check its numbers",
  noAnswer: "the AI service didn't answer",
  privacy: "personal data check",
  noTime: "not enough time left",
};

async function saveAttempt(
  status: CfoBriefStatus,
  reason: string,
  call?: { provider: string; model: string; httpStatus: number },
) {
  await briefs()
    .doc(CFO_BRIEF_STATUS_DOC)
    .set({ at: new Date().toISOString(), status, reason: reason.slice(0, 120), ...call })
    .catch((e) => console.error("cfo brief status failed", short(e)));
}

/**
 * Every name the privacy backup should know: the people in the saved lists, plus the trainers.
 * The brief input itself never holds a name; this only guards against a slip. (Reading every
 * member again would cost about a thousand reads per summary, so members who are in no list
 * are not covered: they can never appear in the numbers either.)
 */
async function knownNames(snapshot: CfoSnapshot): Promise<string[]> {
  const names = new Set<string>();
  for (const t of snapshot.trainers) if (t.name) names.add(t.name);
  try {
    const docs = await db().getAll(...CFO_LIST_KEYS.map((k) => reports().doc(cfoListDocId(k))));
    for (const d of docs) {
      const rows = rec(d.data())["rows"];
      if (Array.isArray(rows))
        for (const r of rows) {
          const name = rec(r)["name"];
          if (typeof name === "string" && name.trim()) names.add(name.trim());
        }
    }
  } catch (e) {
    console.error("cfo names read failed", short(e));
  }
  return [...names];
}

/** Reads the saved numbers; for a manual press it also counts the press (max 3 a day). */
async function snapshotForBrief(manual: boolean, day: ISODate) {
  const ref = reportRef();
  return db().runTransaction(async (tx) => {
    const d = rec((await tx.get(ref)).data());
    if (typeof d["computedAt"] !== "string") return { kind: "none" as const };
    if (manual) {
      const counter = rec(d["manualBriefs"]);
      const used =
        counter["date"] === day && typeof counter["count"] === "number" ? counter["count"] : 0;
      if (used >= CFO_MAX_MANUAL_BRIEFS_PER_DAY) return { kind: "limit" as const };
      tx.update(ref, { manualBriefs: { date: day, count: used + 1 } });
    }
    const { runningSince: _a, readCount: _b, manualBriefs: _c, ...snapshot } = d;
    return { kind: "ok" as const, snapshot: snapshot as unknown as CfoSnapshot };
  });
}

/**
 * Writes the summary from the saved numbers. A failed AI is never an error: it is a status
 * ("failed", "off", "unverified", "blocked", "skipped") saved in cfoBriefs/status, and the
 * newest good summary stays where it is.
 */
export async function makeBrief(
  by: string,
  deadline: number,
  manual: boolean,
): Promise<BriefResult> {
  const day = today();
  const done = async (
    status: CfoBriefStatus,
    reason: string,
    call?: { provider: string; model: string; httpStatus: number },
  ): Promise<BriefResult> => {
    await saveAttempt(status, reason, call);
    return { ok: true, status, reason };
  };
  // Check that the AI can run before a press is counted against the daily limit.
  const settings = await loadSettings();
  if (!settings.aiEnabled) return done("off", REASON.off);
  const cfg = aiConfig();
  if (!cfg) return done("off", REASON.notSetUp);

  const got = await snapshotForBrief(manual, day);
  if (got.kind === "none") return { ok: false, http: 409, error: "Work out the numbers first." };
  if (got.kind === "limit")
    return {
      ok: false,
      http: 429,
      error: `You have already asked for ${CFO_MAX_MANUAL_BRIEFS_PER_DAY} new summaries today. Try again tomorrow.`,
    };
  const snapshot = got.snapshot;

  const input = buildBriefInput(snapshot, settings);
  const userJson = JSON.stringify(input, null, 2);
  const privacy = briefPrivacyCheck(userJson, await knownNames(snapshot));
  if (!privacy.ok) return done("blocked", REASON.privacy);

  // At most 2 AI calls: a network retry and a number-check retry share them.
  let calls = 0;
  let last: "none" | "network" | "numbers" = "none";
  let code = "";
  let httpStatus = 0;
  let found: { text: string; provider: string; model: string } | null = null;
  while (calls < 2 && !found) {
    const left = deadline - Date.now();
    if (left < 10_000) break;
    const system = briefSystemPrompt(settings.language) + (last === "numbers" ? REMINDER : "");
    const result = await callAi(cfg, system, userJson, Math.min(20_000, left - 5_000));
    calls += 1;
    if (!result.ok) {
      last = "network";
      code = result.code;
      httpStatus = result.status;
      continue;
    }
    const check = verifyBriefNumbers(result.text, input);
    if (check.ok) found = result;
    else {
      last = "numbers";
    }
  }

  if (!found) {
    if (calls === 0) return done("skipped", REASON.noTime);
    if (last === "numbers") return done("unverified", REASON.numbers);
    return done("failed", `${REASON.noAnswer}${code ? ` (${code})` : ""}`, {
      provider: cfg.provider,
      model: cfg.model,
      httpStatus,
    });
  }

  const now = new Date();
  const record: CfoBrief = {
    date: day,
    createdAt: now.toISOString(),
    by,
    provider: found.provider,
    model: found.model,
    status: "ok",
    text: found.text.slice(0, 4000),
    input,
    snapshotComputedAt: snapshot.computedAt,
    error: "",
    unknownNumbers: [],
  };
  const batch = db().batch();
  batch.set(briefs().doc(`${day}-${hhmmCompact(now)}`), clean(record));
  batch.set(briefs().doc(CFO_BRIEF_LATEST_DOC), clean(record));
  batch.set(briefs().doc(CFO_BRIEF_STATUS_DOC), {
    at: now.toISOString(),
    status: "ok",
    reason: "",
  });
  await batch.commit();
  return { ok: true, status: "ok", reason: "" };
}

/** True when no OK summary exists since this week's Monday (gym time). */
async function briefDue(day: ISODate) {
  const d = rec((await briefs().doc(CFO_BRIEF_LATEST_DOC).get()).data());
  return !(typeof d["date"] === "string" && d["date"] >= mondayOf(day));
}

/* ------------------------------------------------------------------- morning job */

/**
 * The CFO's step of the morning job. Last step, never throws, never runs without time:
 * numbers only if at least 30 s of the 60 s remain, the summary only if none was written since
 * Monday and at least 25 s remain. Returns a short text for the cron's JSON.
 */
export async function runCfoMorning(startedAt: number): Promise<string> {
  const left = () => 60_000 - (Date.now() - startedAt);
  try {
    if (left() < 30_000) return "skipped: no time";
    const deadline = startedAt + REQUEST_MS;
    const work = (async () => {
      const r = await refreshCfo("Morning job", deadline);
      let part = r.ok ? "ok" : r.kind === "fresh" ? "skipped: fresh" : "skipped: busy";
      if (left() >= 25_000 && (await briefDue(today()))) {
        const b = await makeBrief("Morning job", deadline, false);
        part += `; brief ${b.ok ? b.status : "skipped"}`;
      }
      return part;
    })();
    work.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = new Promise<string>((resolve) => {
      timer = setTimeout(
        () => resolve("error: timed out"),
        Math.max(0, startedAt + 55_000 - Date.now()),
      );
    });
    try {
      return await Promise.race([work, stop]);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("cfo morning step failed", short(e));
    return `error: ${short(e)}`.slice(0, 120);
  }
}

/* ----------------------------------------------------------------------- routes */

export async function handleCfo(request: Request, url: URL): Promise<Response> {
  const startedAt = Date.now();
  try {
    const user = await requireStaff(request);
    if (!user) return json({ error: "Sign in required." }, 401);
    if (!(await requireFeature(request, "finance"))) return json({ error: "Not allowed." }, 403);

    const path = url.pathname.replace(/\/+$/, "");
    if (path !== "/api/cfo/refresh" && path !== "/api/cfo/brief" && path !== "/api/cfo/status")
      return json({ error: "Not found." }, 404);
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);

    // Is an AI connected (provider + key set on the server)? Never the key itself.
    if (path === "/api/cfo/status") {
      const cfg = aiConfig();
      let check = cfg ? await checkAi(cfg) : { ok: false, problem: "" };
      // The model-info check can pass while writing is refused: trust the last real try too.
      if (cfg && check.ok) {
        const last = (await briefs().doc(CFO_BRIEF_STATUS_DOC).get()).data();
        const problem = attemptProblem(
          (last as CfoBriefAttempt | undefined) ?? null,
          cfg.provider,
          cfg.model,
        );
        if (problem) check = { ok: false, problem };
      }
      const ai: CfoAiStatus = {
        connected: Boolean(cfg) && check.ok,
        provider: cfg?.provider ?? "",
        model: cfg?.model ?? "",
        problem: check.problem,
      };
      return json({ ok: true, ai });
    }

    const by = user.email || user.uid;
    const deadline = startedAt + REQUEST_MS;

    if (path === "/api/cfo/refresh") {
      const r = await refreshCfo(by, deadline);
      if (!r.ok) return json({ error: r.error, nextRefreshAt: r.nextRefreshAt }, 429);
      return json({ ok: true, computedAt: r.computedAt, nextRefreshAt: r.nextRefreshAt });
    }

    const b = await makeBrief(by, deadline, true);
    if (!b.ok) return json({ error: b.error }, b.http);
    return json({ ok: true, status: b.status, reason: b.reason });
  } catch (e) {
    console.error("cfo request failed", short(e));
    return json({ error: "Something went wrong. Try again in 2 minutes." }, 500);
  }
}
