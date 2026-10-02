import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  KeyRound,
  Link2,
  Loader2,
  Monitor,
  QrCode,
  RefreshCcw,
  Send,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Field } from "@/components/common/form-dialog";
import { FormSection } from "@/components/common/form-section";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_PHONE_TEXTS,
  PHONE_TEXT_FIELDS,
  PHONE_TEXT_KINDS,
  PHONE_TEXT_LABELS,
  PHONE_TEXT_LINKS,
  renderPhoneText,
  type PhoneTextKind,
} from "@/lib/whatsapp-texts";
import { GYM_PC_SETUP_FILE, gymPcSetupBat } from "@/lib/gym-pc-setup";
import {
  gymPcSetupKey,
  saveWhatsAppGateway,
  sendWhatsAppTest,
  whatsAppGatewayAction,
  type GatewayState,
} from "@/services/whatsapp.service";
import type { WhatsAppSettings } from "@/types/models";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info"> = {
  ready: "success",
  qr_ready: "warning",
  authenticating: "info",
  initializing: "info",
  disconnected: "danger",
  failed: "danger",
  action_required: "danger",
};

/** Example values shown under each message text. */
const SAMPLE: Record<PhoneTextKind, string[]> = {
  invoice: ["Ravi Kumar", "REBUILD FITNESS", "RF-2026-000123", "4,000", "1,500"],
  member_app: ["Ravi Kumar", "REBUILD FITNESS"],
  test: ["there", "REBUILD FITNESS"],
};
const SAMPLE_LINK = { invoice: "https://…/invoice/9f2c…", member_app: "https://…/m/abcd1234" };

/** What the gym's number sends, and what goes another way (shown in Settings). */
const SENDS = ["Bill after each payment", "Member app link after the first payment"];
const NOT_SENT = [
  "Reminders (renewal, balance due, birthday, missed workout): free app notifications instead",
  "Announcements to many members",
];

/**
 * Sending from the gym's own WhatsApp number: the number stays on the gym's phone and is linked
 * to an OpenWA gateway like WhatsApp Web (what the old software's "WhatsApp instance" was). Only
 * bills and member app links go from it (src/lib/whatsapp-texts.ts).
 */
export function WhatsAppGatewaySection({
  active,
  saved,
  form,
  setForm,
  gymName,
  onSave,
  saving,
}: {
  /** Chosen in Send from. When not, it can be linked and tested, but sends nothing else. */
  active: boolean;
  /** The settings as saved (connection state comes from the server). */
  saved: WhatsAppSettings;
  form: WhatsAppSettings;
  setForm: (f: WhatsAppSettings) => void;
  gymName: string;
  /** Saves the message texts (with the rest of the WhatsApp settings). */
  onSave: () => void;
  saving: boolean;
}) {
  const [url, setUrl] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<GatewayState | null>(null);
  const [qr, setQr] = useState<{ image: string; note: string } | null>(null);
  const [pairPhone, setPairPhone] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const connected = Boolean(saved.gatewayUrl && saved.gatewaySessionId);

  // Fill the connection fields from what is saved (once it has loaded).
  useEffect(() => {
    if (!url && saved.gatewayUrl) setUrl(saved.gatewayUrl);
    if (!sessionId && saved.gatewaySessionId) setSessionId(saved.gatewaySessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.gatewayUrl, saved.gatewaySessionId]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const check = (start = false) =>
    run(start ? "start" : "check", async () => {
      const r = await whatsAppGatewayAction(start ? "start" : "status");
      setState(r);
      if (r.status === "ready") setQr(null);
    });
  const showQr = () =>
    run("qr", async () => {
      const r = await whatsAppGatewayAction("qr");
      setQr({ image: r.qrCode ?? "", note: r.note ?? "" });
    });
  const status = state?.status ?? saved.gatewayStatus;
  // WhatsApp's limit on the number: the server pauses sending until it ends.
  const restricted = state?.restriction ?? saved.gatewayRestriction;
  const phoneLabel = state?.phoneLabel || (saved.gatewayPhone ? `+${saved.gatewayPhone}` : "");

  // While the QR is shown, every 5 s: take WhatsApp's newest QR (it changes about every 20 s, an
  // old one can't be scanned), and once there is none, check whether the phone got linked.
  const showing = Boolean(qr?.image);
  useEffect(() => {
    if (!showing) return;
    const t = setInterval(() => {
      void whatsAppGatewayAction("qr")
        .then(async (q) => {
          if (q.qrCode) return setQr({ image: q.qrCode, note: "" });
          const r = await whatsAppGatewayAction("status");
          setState(r);
          if (r.status === "ready") {
            setQr(null);
            toast.success(`WhatsApp linked: ${r.phoneLabel || "the gym's number"}`);
          }
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [showing]);

  const texts = form.phoneTexts ?? {};
  const setText = (k: PhoneTextKind, v: string) =>
    setForm({ ...form, phoneTexts: { ...texts, [k]: v } });

  return (
    <FormSection
      title="Gym's own WhatsApp number (linked phone)"
      description="Messages go out from the gym's WhatsApp number, which stays on the gym's phone. The number is linked to the gym's own WhatsApp gateway (OpenWA) like WhatsApp Web, the same way the old software did."
      footer={
        <Button disabled={saving} onClick={onSave}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save texts
        </Button>
      }
    >
      <div className="grid gap-5">
        {active ? null : (
          <p className="rounded-xl border border-info/40 bg-info/10 p-3 text-sm">
            <b>Not in use yet.</b> Bills go through the WhatsApp Cloud API (Meta). You can link and
            test the gym&apos;s number here first: only Send test goes from it. To use it, choose it
            in <b>Send from</b> above and Save.
          </p>
        )}
        <div className="grid gap-3 rounded-xl border border-border p-3 text-sm sm:grid-cols-2">
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
              <ShieldCheck className="size-4 text-success" aria-hidden /> Sent from this number
            </p>
            <ul className="space-y-1">
              {SENDS.map((x) => (
                <li key={x} className="flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> {x}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 font-semibold">Never sent from it</p>
            <ul className="space-y-1">
              {NOT_SENT.map((x) => (
                <li key={x} className="flex items-start gap-1.5 text-muted-foreground">
                  <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {x}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            This is WhatsApp Web, not Meta&apos;s official API, so WhatsApp could still limit the
            number. Sending only what a member expects right after paying keeps that risk low. Keep
            the gym&apos;s phone using WhatsApp normally: linked devices log out if the phone is off
            for about 14 days.
          </p>
        </div>

        <GymPcBox saved={saved} />

        <Collapsible defaultOpen={saved.gatewayMode === "server"}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="justify-between">
              Or your own server (advanced) <ChevronDown aria-hidden />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Gateway address"
                htmlFor="gw-url"
                hint="Where the OpenWA gateway runs, e.g. https://wa.yourgym.in"
                className="sm:col-span-2"
              >
                <Input
                  id="gw-url"
                  value={url}
                  placeholder="https://"
                  onChange={(e) => setUrl(e.target.value.trim())}
                />
              </Field>
              <Field
                label="Instance ID"
                htmlFor="gw-session"
                hint="The WhatsApp instance (session) ID"
              >
                <Input
                  id="gw-session"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value.trim())}
                />
              </Field>
              <Field
                label="Token (API key)"
                htmlFor="gw-key"
                hint={
                  connected
                    ? "Saved on the server. Leave empty to keep it."
                    : "Kept only on the server, never shown again."
                }
              >
                <Input
                  id="gw-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  placeholder={connected ? "•••••• saved" : "owa_k1_…"}
                  onChange={(e) => setApiKey(e.target.value.trim())}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!!busy || !url || !sessionId || (!apiKey && !connected)}
                onClick={() =>
                  run("save", async () => {
                    const r = await saveWhatsAppGateway({ url, sessionId, apiKey });
                    setApiKey("");
                    setState(r);
                    toast.success("WhatsApp gateway saved", {
                      description:
                        r.status === "ready"
                          ? `Connected: ${r.phoneLabel || "the gym's number"}.`
                          : "Now link the gym's phone: Show QR.",
                    });
                  })
                }
              >
                {busy === "save" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Link2 aria-hidden />
                )}{" "}
                Save connection
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {connected ? (
          <div className="grid gap-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Smartphone className="size-5" aria-hidden />
                <div>
                  <p className="font-semibold">{phoneLabel || "Gym's WhatsApp"}</p>
                  <p className="text-meta">
                    {state?.pushName ? `${state.pushName} · ` : ""}Instance {saved.gatewaySessionId}
                  </p>
                </div>
              </div>
              <StatusPill tone={STATUS_TONE[status] ?? "info"}>
                {state?.statusLabel ?? (status === "ready" ? "Connected" : status || "Not checked")}
              </StatusPill>
            </div>
            {restricted ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                <b>WhatsApp has limited this number</b>
                {state?.restriction ? `: ${state.restriction}` : ""}. Nothing is sent from it until
                that ends. Use the number normally on the phone and don&apos;t link it again.
              </p>
            ) : null}
            {state?.webhook && state.webhook !== "on" ? (
              <p className="text-meta">Delivery ticks: {state.webhook}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => check()}>
                {busy === "check" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <RefreshCcw aria-hidden />
                )}{" "}
                Check
              </Button>
              {status !== "ready" ? (
                <>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => check(true)}>
                    {busy === "start" ? <Loader2 className="animate-spin" aria-hidden /> : null}{" "}
                    Start
                  </Button>
                  <Button size="sm" disabled={!!busy} onClick={() => showQr()}>
                    {busy === "qr" ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <QrCode aria-hidden />
                    )}{" "}
                    Show QR to link the phone
                  </Button>
                </>
              ) : null}
            </div>
            {qr ? (
              qr.image ? (
                <div className="grid justify-items-center gap-2 rounded-xl bg-white p-4 text-center text-sm text-black">
                  <img
                    src={qr.image}
                    alt="QR code to link the gym's WhatsApp"
                    className="size-56"
                  />
                  <p>
                    On the gym&apos;s phone: WhatsApp → <b>Linked devices</b> → <b>Link a device</b>{" "}
                    → scan this code.
                  </p>
                </div>
              ) : (
                <p className="text-meta">{qr.note}</p>
              )
            ) : null}
            {status !== "ready" ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  aria-label="Phone number for a pairing code"
                  inputMode="numeric"
                  placeholder="Or a pairing code for: 9666446131"
                  value={pairPhone}
                  onChange={(e) => setPairPhone(e.target.value.replace(/\D/g, "").slice(0, 15))}
                />
                <Button
                  variant="outline"
                  disabled={!!busy || pairPhone.length < 10}
                  onClick={() =>
                    run("pair", async () => {
                      const r = await whatsAppGatewayAction("pairing", pairPhone);
                      setPairCode(r.pairingCode ?? "");
                    })
                  }
                >
                  Get pairing code
                </Button>
                {pairCode ? (
                  <p className="text-sm sm:col-span-2">
                    On the phone: WhatsApp → Linked devices → Link a device →{" "}
                    <b>Link with phone number instead</b> → enter{" "}
                    <span className="font-mono text-base font-bold tracking-widest">
                      {pairCode}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : restricted ? null : (
              <p className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="size-4" aria-hidden />{" "}
                {active
                  ? "Linked. Bills and member app links go out from this number."
                  : "Linked. Only tests go from it until you choose it in Send from."}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                aria-label="Send a test message to"
                inputMode="numeric"
                placeholder="Send a test message to (mobile number)"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value.replace(/[^\d+]/g, "").slice(0, 15))}
              />
              <Button
                variant="outline"
                disabled={!!busy || testPhone.replace(/\D/g, "").length < 10}
                onClick={() =>
                  run("test", async () => {
                    await sendWhatsAppTest(testPhone, form, gymName, "phone");
                    toast.success("Test message sent", {
                      description: "It should arrive on that WhatsApp in a few seconds.",
                    });
                  })
                }
              >
                {busy === "test" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Send aria-hidden />
                )}{" "}
                Send test
              </Button>
            </div>
          </div>
        ) : null}

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="justify-between">
              Message texts <ChevronDown aria-hidden />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-4">
            <p className="text-meta">
              What each message says. Words in braces are filled in for each member; {"{link}"} is
              the bill page or the member app. Press Save texts below.
            </p>
            {PHONE_TEXT_KINDS.map((k) => {
              const value = texts[k] ?? "";
              const link = PHONE_TEXT_LINKS[k];
              const preview = renderPhoneText(k, SAMPLE[k], link ? SAMPLE_LINK[link] : "", {
                [k]: value,
              });
              return (
                <div key={k} className="grid gap-2 rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{PHONE_TEXT_LABELS[k]}</p>
                    {value ? (
                      <Button size="sm" variant="ghost" onClick={() => setText(k, "")}>
                        Back to the default text
                      </Button>
                    ) : null}
                  </div>
                  <Textarea
                    aria-label={`Text of: ${PHONE_TEXT_LABELS[k]}`}
                    rows={6}
                    value={value || DEFAULT_PHONE_TEXTS[k]}
                    onChange={(e) =>
                      setText(k, e.target.value === DEFAULT_PHONE_TEXTS[k] ? "" : e.target.value)
                    }
                  />
                  <p className="text-meta">
                    Fills in:{" "}
                    {[...PHONE_TEXT_FIELDS[k], ...(link ? ["link"] : [])]
                      .map((f) => `{${f}}`)
                      .join(" ")}
                  </p>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-meta">Preview</summary>
                    <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[#dcf8c6] p-3 text-black">
                      {preview}
                    </p>
                  </details>
                </div>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </FormSection>
  );
}

/** Online when the gym PC reported in the last 15 minutes (it does every 10 while it is on). */
const PC_ONLINE_MS = 15 * 60 * 1000;

/**
 * The plug-and-play way: WhatsApp runs on the gym PC (Docker Desktop). One setup file, double-
 * clicked once; after that it starts with the PC and tells the app its address by itself.
 */
function GymPcBox({ saved }: { saved: WhatsAppSettings }) {
  const [busy, setBusy] = useState<"" | "get" | "new">("");
  const [, setTick] = useState(0);
  // Keep "online · 3 minutes ago" current while Settings stays open.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const seen = saved.gatewayMode === "gym-pc" ? saved.gatewayPcSeenAt : null;
  const online = !!seen && Date.now() - seen.getTime() < PC_ONLINE_MS;

  const download = async (fresh: boolean) => {
    setBusy(fresh ? "new" : "get");
    try {
      const { key } = await gymPcSetupKey(fresh);
      const file = gymPcSetupBat(window.location.origin, key);
      const url = URL.createObjectURL(new Blob([file], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = GYM_PC_SETUP_FILE;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(fresh ? "New setup file downloaded" : "Setup file downloaded", {
        description: fresh
          ? "The old file and the PC using it stop now: run this one on the gym PC."
          : "Double-click it on the gym PC.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <section
      className="grid gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 text-sm"
      aria-label="Gym PC"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <Monitor className="size-5" aria-hidden /> Run it on the gym PC (easiest)
        </p>
        {seen ? (
          <StatusPill tone={online ? "success" : "danger"}>
            {online ? "Gym PC online" : "Gym PC offline"} ·{" "}
            {formatDistanceToNow(seen, { addSuffix: true })}
          </StatusPill>
        ) : (
          <StatusPill tone="info">Not set up yet</StatusPill>
        )}
      </div>
      <ol className="grid list-decimal gap-1.5 pl-5">
        <li>
          On the gym PC (Windows), install{" "}
          <a
            href="https://www.docker.com/products/docker-desktop/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            Docker Desktop
          </a>{" "}
          once (free). Open it and skip the sign-in.
        </li>
        <li>
          Download the setup file below and double-click it on the gym PC. If Windows warns, press{" "}
          <b>More info → Run anyway</b>. The first time takes 5–15 minutes.
        </li>
        <li>
          This box turns <b>Gym PC online</b>. Then press <b>Show QR</b> below and scan it with the
          gym&apos;s WhatsApp (Linked devices → Link a device). Only once.
        </li>
      </ol>
      <p className="text-meta">
        After that, nothing to do: it starts by itself whenever the PC is on, and messages go out
        while it is. When the PC is off, bills wait: press Retry once it is on.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!!busy} onClick={() => void download(false)}>
          {busy === "get" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Download aria-hidden />
          )}{" "}
          Download setup file
        </Button>
        {seen ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={!!busy}
            onClick={() => void download(true)}
            title="Makes a new key: the old setup file and the PC using it stop working"
          >
            {busy === "new" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <KeyRound aria-hidden />
            )}{" "}
            New setup key
          </Button>
        ) : null}
      </div>
    </section>
  );
}
