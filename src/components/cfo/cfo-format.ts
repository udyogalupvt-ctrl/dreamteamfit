import { useEffect, useState } from "react";
import type { CfoTone } from "@/lib/cfo/types";

/** The CFO page works in India time, whatever the browser's clock says. */
const IST = "Asia/Kolkata";

/** The word that goes with every colour, so colour is never the only signal. */
export const TONE_WORD: Record<CfoTone, string> = {
  good: "Good",
  warn: "Watch",
  bad: "Problem",
  none: "Not enough data",
};

export const TONE_BAR: Record<CfoTone, string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  none: "bg-border",
};

/** Re-renders now and then, so "you can refresh again at 10:15" and "worked out 5 h ago" stay true. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });

/** "8:02 AM" in India time. */
export function clockText(d: Date) {
  return d
    .toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: IST,
    })
    .toUpperCase();
}

/** "8:02 AM today", "8:02 AM yesterday" or "Mon 6 Oct, 8:02 AM". */
export function whenText(iso: string, nowMs: number) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = istDay(d);
  const today = istDay(new Date(nowMs));
  const yesterday = istDay(new Date(nowMs - 86_400_000));
  if (day === today) return `${clockText(d)} today`;
  if (day === yesterday) return `${clockText(d)} yesterday`;
  return `${dayText(iso)}, ${clockText(d)}`;
}

/** "Mon 6 Oct" in India time. */
export function dayText(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const wd = d.toLocaleDateString("en-IN", { weekday: "short", timeZone: IST });
  const dm = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
  return `${wd} ${dm}`;
}

/** "October" from "2026-10". */
export function monthLong(key: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    timeZone: "UTC",
  });
}

/** "Oct" from "2026-10". */
export function monthShort(key: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString("en-IN", {
    month: "short",
    timeZone: "UTC",
  });
}
