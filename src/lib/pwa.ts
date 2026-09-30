/**
 * "Install app": Chrome and Edge (desktop and Android) offer it through the beforeinstallprompt
 * event; iPhone/iPad have no button, the app is added with Share → Add to Home Screen. Once the
 * app is installed (or opened as the installed app) nothing is offered any more.
 */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export interface InstallState {
  /** The browser can show its own install dialog now. */
  canPrompt: boolean;
  /** Installed, or running as the installed app. */
  installed: boolean;
  /** iPhone / iPad: installing is done from the Share menu. */
  ios: boolean;
}

let deferred: InstallPrompt | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

const runningInstalled = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const NOT_READY: InstallState = { canPrompt: false, installed: false, ios: false };

export function installState(): InstallState {
  if (typeof window === "undefined") return NOT_READY;
  return {
    canPrompt: Boolean(deferred),
    installed: installedNow || runningInstalled(),
    ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
  };
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Opens the browser's install dialog. True when the app was installed. */
export async function promptInstall() {
  const e = deferred;
  if (!e) return false;
  await e.prompt();
  const choice = await e.userChoice;
  deferred = null;
  if (choice.outcome === "accepted") installedNow = true;
  notify();
  return choice.outcome === "accepted";
}

let started = false;
/** Listen for the install offer and register the service worker (once, in the browser). */
export function startPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // shown from our own "Install app" button instead of a mini-bar
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installedNow = true;
    deferred = null;
    notify();
  });
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }
}
