import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { ThemeProvider, themeBootstrapScript } from "@/hooks/use-theme";
import { colorThemeBootstrapScript } from "@/lib/theme-colors";
import { AuthProvider } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { startPwa } from "@/lib/pwa";
import { markNewVersion } from "@/lib/app-version";

// Installable app: listen for the browser's install offer and register the service worker.
startPwa();

/** Load the new version once, by itself (never in a loop: once per minute at most). */
function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem("rf-reloaded-at") ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem("rf-reloaded-at", String(Date.now()));
  } catch {
    // Storage blocked: still reload once.
  }
  window.location.reload();
  return true;
}

/**
 * A tab left open all day keeps running the version it was opened with (the front desk's tab
 * kept saving plans the old way after an update). Every 5 minutes, and when the tab is shown
 * again, it asks for the live version; a newer one loads by itself once nothing is open or being
 * typed (no popup, no typing for 20 s), else a Refresh button is offered.
 *
 * The installed app on a phone is never "refreshed" by hand (no address bar, no pull to refresh)
 * and is mostly sent to the background, not closed: the new version loads while it is in the
 * background, and at the latest when it is opened again.
 */
function useNewVersion() {
  useEffect(() => {
    if (__APP_BUILD__ === "dev") return;
    let newer = "";
    let lastCheck = 0;
    let lastInput = Date.now();
    let offered = false;
    const busy = () => {
      const a = document.activeElement;
      return (
        !!document.querySelector('[role="dialog"], [role="alertdialog"]') ||
        (a instanceof HTMLElement &&
          (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)))
      );
    };
    const tryLoad = (resumed = false) => {
      if (!newer) return;
      let tried = "";
      try {
        tried = sessionStorage.getItem("rf-reload-build") ?? "";
      } catch {
        // Storage blocked: the one-per-minute guard still stops a loop.
      }
      // Once per new version: if it is still old after that, only the button is offered.
      // Coming back to the app (or leaving it) is not typing: no need to wait 20 s then.
      if (tried !== newer && !busy() && (resumed || Date.now() - lastInput > 20_000)) {
        try {
          sessionStorage.setItem("rf-reload-build", newer);
        } catch {
          // ignore
        }
        if (reloadForNewVersion()) return;
      }
      if (offered) return;
      offered = true;
      toast("A new version of the app is ready", {
        id: "new-version",
        description: "It loads by itself when nothing is open. Or tap Refresh now.",
        duration: Infinity,
        dismissible: true,
        action: { label: "Refresh", onClick: () => window.location.reload() },
      });
    };
    const check = async (resumed = false) => {
      if (Date.now() - lastCheck < 60_000) {
        tryLoad(resumed);
        return;
      }
      lastCheck = Date.now();
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const build = r.ok ? String(((await r.json()) as { build?: unknown }).build ?? "") : "";
        if (build && build !== __APP_BUILD__) {
          newer = build;
          markNewVersion();
        }
      } catch {
        // Offline: asked again later.
      }
      tryLoad(resumed);
    };
    const onInput = () => {
      lastInput = Date.now();
    };
    const onShow = () => {
      // Shown again: ask now and load a newer version straight away. Sent to the background
      // (phone app switched away): a newer version already known loads there, unseen.
      if (document.visibilityState === "visible") void check(true);
      else tryLoad(true);
    };
    // Android / iPhone may keep the app frozen and bring the same page back (back-forward cache).
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check(true);
    };
    const first = window.setTimeout(() => void check(), 15_000);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastCheck >= 5 * 60_000)
        void check();
      else tryLoad();
    }, 20_000);
    const events = ["keydown", "pointerdown", "input"] as const;
    events.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onShow);
      window.clearTimeout(first);
      window.clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, onInput));
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
}

// A page file of the old version is gone after an update went live (tab left open): load the
// new version instead of showing an error, wherever the file was asked for.
if (typeof window !== "undefined")
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewVersion()) event.preventDefault();
  });

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

/** A tab opened before a new version went live asks for page files that no longer exist. */
const STALE_BUILD =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  // The app was updated while this page was open: its old page files are gone, so trying again
  // in place can never work. Only loading the page again (the new version) does.
  const stale = STALE_BUILD.test(String((error as Error | undefined)?.message ?? error));
  useEffect(() => {
    console.error(error);
    if (stale) reloadForNewVersion();
  }, [error, stale]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {stale ? "The app was updated" : "This page didn't load"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {stale
            ? "Tap below to open the new version. Nothing you saved is lost."
            : "Something went wrong on our end. You can try refreshing or head back home."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              // A full load gets the new version's files (and clears a stuck error for good).
              if (stale) {
                window.location.reload();
                return;
              }
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {stale ? "Open the new version" : "Try again"}
          </button>
          <a
            // A member's / trainer's app goes back to their own page, not the staff login.
            href={
              typeof window !== "undefined" && /^\/(m|t)\//.test(window.location.pathname)
                ? window.location.pathname
                : "/"
            }
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: ({ matches }) => {
    // A member's / trainer's link installs as their own app (opens on their link, not /dashboard).
    const portal = matches.find((m) => ["/m/$code", "/t/$code"].includes(String(m.routeId)));
    const code = (portal?.params as { code?: string } | undefined)?.code ?? "";
    const manifest =
      portal && code
        ? `/api/portal/manifest/${String(portal.routeId)[1]}/${code}`
        : "/manifest.webmanifest";
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        // Installable app ("Install app" on phones and computers).
        { name: "theme-color", content: "#121110" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-title", content: "Rebuild Fitness" },
        { name: "apple-mobile-web-app-status-bar-style", content: "black" },
        { title: "REBUILD FITNESS — Gym Management" },
        {
          name: "description",
          content: "REBUILD FITNESS staff workspace for members, memberships and gym operations.",
        },
        { property: "og:title", content: "REBUILD FITNESS — Gym Management" },
        {
          property: "og:description",
          content: "REBUILD FITNESS staff workspace for members, memberships and gym operations.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
        },
        { rel: "manifest", href: manifest },
        { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
        { rel: "icon", href: "/favicon-48.png", type: "image/png", sizes: "48x48" },
        { rel: "icon", href: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <script dangerouslySetInnerHTML={{ __html: colorThemeBootstrapScript }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useNewVersion();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster position="top-right" richColors closeButton />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
