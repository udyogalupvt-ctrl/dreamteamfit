import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { authErrorMessage } from "@/services/auth.service";
import { APP_NAME } from "@/constants/navigation";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — REBUILD FITNESS" },
      {
        name: "description",
        content: "Staff sign-in for the REBUILD FITNESS management workspace.",
      },
      { property: "og:title", content: "Sign in — REBUILD FITNESS" },
      {
        property: "og:description",
        content: "Staff sign-in for the REBUILD FITNESS management workspace.",
      },
    ],
  }),
  component: LoginPage,
});

const HIGHLIGHTS = [
  "Memberships, renewals and expiries in one view",
  "POS billing, invoices and collection tracking",
  "Attendance, biometric sync and follow-up pipelines",
];

function LoginPage() {
  const { login, status, configured } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") navigate({ to: "/dashboard", replace: true });
  }, [status, navigate]);

  const validate = () => {
    const next: { email?: string; password?: string } = {};
    if (!email.trim()) next.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = "Enter a valid email address.";
    if (!password) next.password = "Password is required.";
    else if (password.length < 6) next.password = "Password must be at least 6 characters.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    if (!configured) {
      setFormError(
        "Sign-in is not available yet: the Firebase web API key is still missing from the project settings.",
      );
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password, remember);
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      setFormError(authErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-foreground p-10 text-background lg:flex">
        <div
          aria-hidden
          className="absolute -top-32 -right-24 size-[28rem] rounded-full bg-primary/25 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-16" />
          <div>
            <p className="font-display text-lg font-extrabold tracking-tight">{APP_NAME}</p>
            <p className="text-xs opacity-70">Gym Management</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-4xl leading-[1.05] font-extrabold tracking-tight">
            Run your gym like a<span className="text-primary"> championship team.</span>
          </h1>
          <ul className="mt-8 space-y-3">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm opacity-90">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs opacity-60">
          Staff access only · All activity is logged for audit.
        </p>
      </section>

      {/* Form panel */}
      <section className="flex flex-col bg-background px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 lg:hidden">
            <BrandMark className="size-14" />
            <span className="font-display text-base font-extrabold">{APP_NAME}</span>
          </div>
          <ThemeToggle className="ml-auto" />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h2 className="text-page-title">Staff sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Use your work email to access the REBUILD FITNESS workspace.
          </p>

          {formError ? (
            <p
              role="alert"
              className="mt-5 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{formError}</span>
            </p>
          ) : null}

          <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Work email</Label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@gym.com"
                  className="h-11 pl-9"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "email-error" : undefined}
                />
              </div>
              {errors.email ? (
                <p id="email-error" className="text-xs font-medium text-destructive">
                  {errors.email}
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <LockKeyhole
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="h-11 pr-11 pl-9"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? "password-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
              {errors.password ? (
                <p id="password-error" className="text-xs font-medium text-destructive">
                  {errors.password}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={remember}
                onCheckedChange={(checked) => setRemember(checked === true)}
              />
              <Label htmlFor="remember" className="text-sm font-medium">
                Keep me signed in on this device
              </Label>
            </div>

            <Button type="submit" size="lg" disabled={submitting} className="mt-1">
              {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-xs text-muted-foreground">
            Accounts are created by gym administrators. Contact your manager if you need access.
          </p>
        </div>
      </section>
    </div>
  );
}
