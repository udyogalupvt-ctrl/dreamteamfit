/**
 * Body progress: weight, body fat, tape measurements and photos, logged by the member (/m), their
 * PT trainer (/t) or the desk.
 *
 * All of a member's entries live in ONE doc, bodyProgress/{clientId}.entries (oldest first), like
 * memberVisits: the member app reads them with its one /me call instead of a read per entry.
 * A member or trainer changes only their own entries; the desk can change any.
 */
import type { BodyEntry, BodyEntryAuthor, BodyEntryInput, BodyMeasurements } from "../types/models";

export const MEASUREMENT_KEYS = ["chest", "waist", "hips", "arm", "thigh"] as const;
export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];
export type BodyMetric = "weightKg" | "bodyFatPct" | MeasurementKey;

export interface BodyMetricInfo {
  key: BodyMetric;
  label: string;
  unit: "kg" | "%" | "cm";
  min: number;
  max: number;
}

/** Chart chips and list order. */
export const BODY_METRICS: readonly BodyMetricInfo[] = [
  { key: "weightKg", label: "Weight", unit: "kg", min: 20, max: 300 },
  { key: "bodyFatPct", label: "Body fat", unit: "%", min: 2, max: 70 },
  { key: "waist", label: "Waist", unit: "cm", min: 10, max: 250 },
  { key: "chest", label: "Chest", unit: "cm", min: 10, max: 250 },
  { key: "hips", label: "Hips", unit: "cm", min: 10, max: 250 },
  { key: "arm", label: "Arm", unit: "cm", min: 10, max: 250 },
  { key: "thigh", label: "Thigh", unit: "cm", min: 10, max: 250 },
];

export const BODY_LIMITS = { photos: 3, note: 300, entries: 400 } as const;

const round1 = (v: number) => Math.round(v * 10) / 10;

/** "72,46" / "72.46" / 72.46 → 72.5; blank, junk or ≤ 0 → 0 (not measured). */
export function bodyNumber(v: unknown): number {
  const x =
    typeof v === "number"
      ? v
      : Number(
          String(v ?? "")
            .trim()
            .replace(",", "."),
        );
  return Number.isFinite(x) && x > 0 ? round1(x) : 0;
}

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Whatever the form or the request sent → a clean entry. */
export function cleanBodyEntry(raw: unknown): BodyEntryInput {
  const r = obj(raw);
  const m = obj(r["measurements"]);
  const photos = Array.isArray(r["photos"]) ? (r["photos"] as unknown[]) : [];
  return {
    date: typeof r["date"] === "string" ? r["date"].trim() : "",
    weightKg: bodyNumber(r["weightKg"]),
    bodyFatPct: bodyNumber(r["bodyFatPct"]),
    measurements: Object.fromEntries(
      MEASUREMENT_KEYS.map((k) => [k, bodyNumber(m[k])]),
    ) as unknown as BodyMeasurements,
    photos: photos
      .filter((p): p is string => typeof p === "string" && p.trim() !== "")
      .map((p) => p.trim()),
    note: typeof r["note"] === "string" ? r["note"].trim() : "",
  };
}

type Numbers = Pick<BodyEntryInput, "weightKg" | "bodyFatPct" | "measurements">;

export const metricValue = (e: Numbers, metric: BodyMetric): number =>
  metric === "weightKg"
    ? e.weightKg
    : metric === "bodyFatPct"
      ? e.bodyFatPct
      : e.measurements[metric];

export const metricInfo = (metric: BodyMetric) => BODY_METRICS.find((m) => m.key === metric)!;

/** "" when the entry can be saved, otherwise what to fix. */
export function validateBodyEntry(e: BodyEntryInput, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(Date.parse(e.date)) || e.date < "2000")
    return "Pick the date.";
  if (e.date > today) return "The date can't be in the future.";
  for (const m of BODY_METRICS) {
    const v = metricValue(e, m.key);
    if (v && (v < m.min || v > m.max))
      return `${m.label} must be between ${m.min} and ${m.max} ${m.unit}.`;
  }
  if (e.photos.length > BODY_LIMITS.photos) return `Up to ${BODY_LIMITS.photos} photos.`;
  if (e.note.length > BODY_LIMITS.note) return "The note is too long.";
  if (!BODY_METRICS.some((m) => metricValue(e, m.key)) && !e.photos.length)
    return "Enter at least one number or add a photo.";
  return "";
}

/** The desk can change any entry; a member or trainer only the ones they logged. */
export const canChangeEntry = (
  e: Pick<BodyEntry, "by">,
  actor: Pick<BodyEntryAuthor, "kind" | "id">,
) => actor.kind === "staff" || (e.by.kind === actor.kind && e.by.id === actor.id);

const byDate = (a: BodyEntry, b: BodyEntry) => a.date.localeCompare(b.date) || a.at - b.at;

/** Adds the entry, or replaces the one with its id (the author and first-saved time stay). */
export function putEntry(entries: BodyEntry[], entry: BodyEntry): BodyEntry[] {
  const old = entries.find((e) => e.id === entry.id);
  const next = old ? { ...entry, by: old.by, at: old.at } : entry;
  return [...entries.filter((e) => e.id !== entry.id), next].sort(byDate);
}

const KINDS = ["member", "trainer", "staff"] as const;

/** bodyProgress/{clientId} as stored (or missing) → its entries, oldest first. */
export function readEntries(raw: unknown): BodyEntry[] {
  const list = obj(raw)["entries"];
  if (!Array.isArray(list)) return [];
  return list
    .map(obj)
    .filter((e) => typeof e["id"] === "string" && e["id"] !== "")
    .map((e) => {
      const by = obj(e["by"]);
      const kind = KINDS.find((k) => k === by["kind"]) ?? "staff";
      return {
        ...cleanBodyEntry(e),
        id: e["id"] as string,
        by: { kind, id: String(by["id"] ?? ""), name: String(by["name"] ?? "") },
        at: Number(e["at"]) || 0,
      };
    })
    .sort(byDate);
}

/** One point per day (the last entry that day), oldest first; days without this number skipped. */
export function progressSeries(entries: BodyEntry[], metric: BodyMetric) {
  const days = new Map<string, number>();
  for (const e of [...entries].sort(byDate)) {
    const v = metricValue(e, metric);
    if (v) days.set(e.date, v);
  }
  return [...days].map(([date, value]) => ({ date, value }));
}

/** Numbers this member has at least one value for, in chip order. */
export const metricsWithData = (entries: BodyEntry[]) =>
  BODY_METRICS.filter((m) => entries.some((e) => metricValue(e, m.key)));

/** First and latest value of a number and the change between them; null = never measured. */
export function metricChange(entries: BodyEntry[], metric: BodyMetric) {
  const s = progressSeries(entries, metric);
  const first = s[0];
  const latest = s.at(-1);
  if (!first || !latest) return null;
  return { first, latest, change: round1(latest.value - first.value) };
}

/** First vs latest day with a photo, for "Compare photos"; null until two days have photos. */
export function photoPair(entries: BodyEntry[]) {
  const withPhotos = [...entries].sort(byDate).filter((e) => e.photos.length);
  const a = withPhotos[0];
  const b = withPhotos.at(-1);
  if (!a || !b || a.date === b.date) return null;
  return {
    first: { date: a.date, url: a.photos[0]! },
    latest: { date: b.date, url: b.photos[0]! },
  };
}

/** 72.5 → "72.5 kg", 18 → "18%". */
export function formatMetric(value: number, metric: BodyMetric) {
  const { unit } = metricInfo(metric);
  return unit === "%" ? `${round1(value)}%` : `${round1(value)} ${unit}`;
}

/** −2.4 → "−2.4 kg", 1.5 → "+1.5 cm", 0 → "No change". */
export function formatChange(change: number, metric: BodyMetric) {
  if (!change) return "No change";
  return `${change > 0 ? "+" : "−"}${formatMetric(Math.abs(change), metric)}`;
}

/** The short line in lists: "72.5 kg · Body fat 18% · Waist 82 cm". */
export const entryLine = (e: Numbers) =>
  BODY_METRICS.filter((m) => metricValue(e, m.key))
    .map((m) =>
      m.key === "weightKg"
        ? formatMetric(e.weightKg, m.key)
        : `${m.label} ${formatMetric(metricValue(e, m.key), m.key)}`,
    )
    .join(" · ");
