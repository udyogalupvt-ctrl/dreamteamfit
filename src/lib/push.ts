/**
 * Phone notifications in the member app / trainer app (Web Push, free). Android and computers:
 * Chrome, Edge, Firefox, Samsung Internet. iPhone / iPad (iOS 16.4+): only in the app added to the
 * Home Screen, Apple's rule. The gym can switch them all off in Settings → Reminders.
 */
import { portalCall } from "@/lib/portal-firebase";

export type PushStatus =
  /** This browser can't show notifications. */
  | "unsupported"
  /** iPhone in Safari: add the app to the Home Screen first, then turn them on there. */
  | "install-first"
  /** The person said no; only the phone's settings can undo that. */
  | "blocked"
  | "off"
  | "on";

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
const iosBrowser = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !window.matchMedia?.("(display-mode: standalone)").matches &&
  (navigator as Navigator & { standalone?: boolean }).standalone !== true;

const toBytes = (b64u: string) => {
  const raw = atob(b64u.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const toB64u = (buf: ArrayBuffer | null) =>
  buf
    ? btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")
    : "";

/** The app's service worker (registered on load by startPwa); null when there is none. */
async function registration() {
  if (!supported()) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 8000)),
  ]);
}

export async function pushStatus(): Promise<PushStatus> {
  if (typeof window === "undefined") return "unsupported";
  if (!supported()) return iosBrowser() ? "install-first" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}

const SYNCED = "rf-push-synced";
async function save(sub: PushSubscription) {
  await portalCall("/api/push/subscribe", { subscription: sub.toJSON() });
  try {
    localStorage.setItem(SYNCED, String(Date.now()));
  } catch {
    /* storage blocked: synced again next time */
  }
}

/** Asks the phone for permission and links this phone to the signed-in member / trainer. */
export async function enablePush(): Promise<PushStatus> {
  if (!supported()) return pushStatus();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const reg = await registration();
  if (!reg) throw new Error("Notifications are not ready yet. Reload the page and try again.");
  const r = await fetch("/api/push/key");
  if (!r.ok) throw new Error("Couldn't reach the gym's server. Try again.");
  const { publicKey } = (await r.json()) as { publicKey: string };
  let sub = await reg.pushManager.getSubscription();
  if (sub && toB64u(sub.options.applicationServerKey) !== publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: toBytes(publicKey),
  });
  await save(sub);
  return "on";
}

export async function disablePush(): Promise<PushStatus> {
  const reg = supported() ? await navigator.serviceWorker.getRegistration() : null;
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await portalCall("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
  }
  return pushStatus();
}

/**
 * Notifications already on: tell the server again about once a week (the phone may have been
 * given a new address, or another member signed in on this phone). One small write a week.
 */
export async function refreshPush() {
  if ((await pushStatus()) !== "on") return;
  let last = 0;
  try {
    last = Number(localStorage.getItem(SYNCED) || 0);
  } catch {
    /* storage blocked */
  }
  if (Date.now() - last < 7 * 86_400_000) return;
  const sub = await (
    await navigator.serviceWorker.getRegistration()
  )?.pushManager.getSubscription();
  if (sub) await save(sub).catch(() => undefined);
}
