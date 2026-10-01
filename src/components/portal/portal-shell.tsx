import { useCallback, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { Eye, EyeOff, Link2Off, Loader2, LockKeyhole, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isPortalCode, type PortalKind } from "@/constants/portal";
import {
  portalAuth,
  portalCall,
  portalSignIn,
  portalSignInError,
  portalSignOut,
  signedInAs,
} from "@/lib/portal-firebase";
import { disablePush } from "@/lib/push";
import { cn } from "@/lib/utils";

type Hello = { firstName: string; gymName: string; logoUrl: string; active: boolean };

/** Sign-in for a member / trainer link. Shows `children` once signed in with this link. */
export function PortalGate({
  kind,
  code,
  children,
}: {
  kind: PortalKind;
  code: string;
  children: ReactNode;
}) {
  const [auth, setAuth] = useState<"loading" | "in" | "out">("loading");
  const [hello, setHello] = useState<Hello | "invalid" | null>(null);
  useEffect(
    () => onAuthStateChanged(portalAuth, () => setAuth(signedInAs(kind, code) ? "in" : "out")),
    [kind, code],
  );
  useEffect(() => {
    if (!isPortalCode(code)) return setHello("invalid");
    void fetch(`/api/portal/hello?kind=${kind}&code=${encodeURIComponent(code)}`)
      .then(async (r) => (r.ok ? setHello((await r.json()) as Hello) : setHello("invalid")))
      .catch(() => setHello(null));
  }, [kind, code]);

  if (auth === "in") return <>{children}</>;
  if (auth === "loading" || hello === null)
    return (
      <main className="grid min-h-dvh place-items-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </main>
    );
  if (hello === "invalid")
    return (
      <Centered>
        <Link2Off className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-bold">This link is not valid</h1>
        <p className="text-sm text-muted-foreground">
          Please ask the gym front desk to send your link again.
        </p>
      </Centered>
    );
  return <SignIn kind={kind} code={code} hello={hello} />;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="surface-card w-full max-w-sm space-y-4 p-6 text-center">{children}</div>
    </main>
  );
}

function SignIn({ kind, code, hello }: { kind: PortalKind; code: string; hello: Hello }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const member = kind === "member";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return setError(member ? "Enter your date of birth." : "Enter your password.");
    setBusy(true);
    setError("");
    try {
      // Members may type 25-08-1995 or 25/08/1995: only the digits count.
      await portalSignIn(kind, code, member ? password.replace(/\D/g, "") : password);
    } catch (err) {
      setError(portalSignInError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <form onSubmit={submit} className="surface-card w-full max-w-sm space-y-5 p-6" noValidate>
        <div className="space-y-2 text-center">
          {hello.logoUrl ? (
            <img src={hello.logoUrl} alt="" className="mx-auto size-16 rounded-xl object-contain" />
          ) : null}
          <p className="text-eyebrow">{hello.gymName}</p>
          <h1 className="text-xl font-bold">
            Hi {hello.firstName}, welcome to your {member ? "member" : "trainer"} app
          </h1>
        </div>
        {!hello.active ? (
          <p role="alert" className="rounded-lg bg-warning/15 p-3 text-sm font-medium">
            This login is switched off. Please contact the gym.
          </p>
        ) : null}
        <div className="grid gap-1.5">
          <label htmlFor="portal-pass" className="text-label">
            {member ? "Password (your date of birth)" : "Password"}
          </label>
          <div className="relative">
            <LockKeyhole
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="portal-pass"
              type={show ? "text" : "password"}
              inputMode={member ? "numeric" : "text"}
              autoComplete="current-password"
              placeholder={member ? "DDMMYYYY" : "••••••"}
              className="h-12 pr-11 pl-9 text-base tracking-wider"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error)}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent"
            >
              {show ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </button>
          </div>
          {member ? (
            <p className="text-meta">
              Day, month, year. Born on 25 Aug 1995? Type <b>25081995</b>.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null} Open my app
        </Button>
        <p className="text-meta text-center">
          Forgot the password? Ask the front desk to send your link again.
        </p>
      </form>
    </main>
  );
}

/** Loads /api/portal/me for the signed-in link. Signs out when the login stopped working. */
export function usePortalData<T>() {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({
    data: null,
    error: "",
    loading: true,
  });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    // A dropped connection or a slow server start is tried again twice before showing an error.
    for (let attempt = 0; ; attempt += 1) {
      try {
        setState({ data: await portalCall<T>("/api/portal/me"), error: "", loading: false });
        return;
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) await portalSignOut();
        const passing = !status || status >= 500;
        if (passing && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
          continue;
        }
        const message = status
          ? (e as Error).message
          : "No internet connection. This opens again by itself when the internet is back.";
        setState((s) => ({ ...s, error: message, loading: false }));
        return;
      }
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Internet back after a drop: load again by itself (no refresh needed).
  useEffect(() => {
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);
  // Opened again from the phone's background after a while: show today's numbers.
  useEffect(() => {
    let last = Date.now();
    const onShow = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 60_000) return;
      last = Date.now();
      void load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [load]);
  return { ...state, reload: load };
}

export function PortalLoading() {
  return (
    <div className="grid min-h-[50dvh] place-items-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}

export function PortalError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="surface-card mx-auto mt-10 max-w-sm space-y-3 p-6 text-center">
      <p className="font-semibold">{message || "Couldn't load your details."}</p>
      <div className="flex justify-center gap-2">
        <Button onClick={onRetry}>
          <RefreshCw aria-hidden /> Try again
        </Button>
        <Button variant="outline" onClick={() => portalSignOut()}>
          <LogOut aria-hidden /> Sign out
        </Button>
      </div>
    </div>
  );
}

export function PortalHeader({
  gymName,
  logoUrl,
  title,
  onRefresh,
  refreshing = false,
}: {
  gymName: string;
  logoUrl: string;
  title: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-lg object-contain" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-muted-foreground">{gymName}</p>
          <p className="truncate font-display text-base leading-tight font-extrabold">{title}</p>
        </div>
        {onRefresh ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh"
            aria-busy={refreshing}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Sign out"
          // Signing out also stops this phone's notifications for this login.
          onClick={() => disablePush().finally(() => void portalSignOut())}
        >
          <LogOut aria-hidden />
        </Button>
      </div>
    </header>
  );
}

export type NavItem<T extends string> = {
  id: T;
  label: string;
  icon: typeof LogOut;
  dot?: boolean;
};

export function BottomNav<T extends string>({
  items,
  value,
  onChange,
}: {
  items: NavItem<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-2xl">
        {items.map((it) => {
          const Icon = it.icon;
          const on = it.id === value;
          return (
            <li key={it.id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(it.id)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex h-16 w-full cursor-pointer flex-col items-center justify-center gap-1 text-[11px] font-semibold",
                  on ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-full transition-colors",
                    on && "bg-primary text-primary-foreground",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                {it.label}
                {it.dot ? (
                  <span
                    className="absolute top-2 right-[calc(50%-18px)] size-2.5 rounded-full bg-destructive ring-2 ring-background"
                    aria-label="New message"
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ------------------------------------------------------------------ small formatters

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-25" → "25 Sep 2026". */
export const day = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—";
};
export const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
