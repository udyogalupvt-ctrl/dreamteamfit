import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Link2,
  Loader2,
  QrCode,
  RefreshCcw,
  Send,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
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
  renderPhoneText,
  type PhoneTextKind,
} from "@/lib/whatsapp-texts";
import {
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
  payment_due: ["Ravi Kumar", "REBUILD FITNESS", "1,500", "RF-2026-000123", "5 Oct 2026"],
  renewal: ["Ravi Kumar", "REBUILD FITNESS", "23 Oct 2026"],
  birthday: ["Ravi Kumar", "REBUILD FITNESS"],
  absence: ["Ravi Kumar", "REBUILD FITNESS", "3", "The only bad workout is the one you skipped."],
  announcement: ["Ravi", "REBUILD FITNESS", "The gym is closed this Sunday for maintenance."],
  member_app: ["Ravi Kumar", "REBUILD FITNESS"],
  test: ["there", "REBUILD FITNESS"],
};

/**
 * Sending from the gym's own WhatsApp number: the number stays on the gym's phone and is linked
 * to an OpenWA gateway like WhatsApp Web (what the old software's "WhatsApp instance" was).
 */
export function WhatsAppGatewaySection({
  saved,
  form,
  setForm,
  gymName,
  onSave,
  saving,
}: {
  /** The settings as saved (connection state comes from the server). */
  saved: WhatsAppSettings;
  form: WhatsAppSettings;
  setForm: (f: WhatsAppSettings) => void;
  gymName: string;
  /** Saves the message texts and announcement speed (with the rest of the WhatsApp settings). */
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
  const phoneLabel = state?.phoneLabel || (saved.gatewayPhone ? `+${saved.gatewayPhone}` : "");

  // While the QR is shown, check every 5 s whether the phone has scanned it.
  useEffect(() => {
    if (!qr?.image) return;
    const t = setInterval(() => {
      void whatsAppGatewayAction("status")
        .then((r) => {
          setState(r);
          if (r.status === "ready") {
            setQr(null);
            toast.success(`WhatsApp linked: ${r.phoneLabel || "the gym's number"}`);
          }
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [qr?.image]);

  const texts = form.phoneTexts ?? {};
  const setText = (k: PhoneTextKind, v: string) =>
    setForm({ ...form, phoneTexts: { ...texts, [k]: v } });

  return (
    <FormSection
      title="Gym's own WhatsApp number (linked phone)"
      description="Messages go out from the gym's WhatsApp number, which stays on the gym's phone. The number is linked to a WhatsApp gateway (OpenWA) like WhatsApp Web, the same way the old software did."
      footer={
        <Button disabled={saving} onClick={onSave}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save texts &amp; speed
        </Button>
      }
    >
      <div className="grid gap-5">
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            This is WhatsApp Web, not Meta&apos;s official API. Keep the gym&apos;s phone charged
            and on the internet. WhatsApp can block a number that sends many messages quickly, so
            announcements go out slowly, one every few seconds. Message only members who agreed to
            WhatsApp.
          </p>
        </div>

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
          <Field label="Instance ID" htmlFor="gw-session" hint="The WhatsApp instance (session) ID">
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
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="size-4" aria-hidden /> Linked. Bills and reminders go out
                from this number.
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
                    await sendWhatsAppTest(testPhone, form, gymName);
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

        <Field
          label="Seconds between announcement messages"
          htmlFor="gw-gap"
          className="sm:max-w-xs"
          hint="Slower is safer for the number. 8 seconds = about 450 messages an hour."
        >
          <Input
            id="gw-gap"
            type="number"
            min={3}
            max={120}
            value={form.phoneGapSeconds}
            onChange={(e) => setForm({ ...form, phoneGapSeconds: Number(e.target.value) || 8 })}
          />
        </Field>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="justify-between">
              Message texts <ChevronDown aria-hidden />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-4">
            <p className="text-meta">
              What each message says. Words in braces are filled in for each member; {"{link}"} is
              the bill page or the member app. Press Save texts &amp; speed below.
            </p>
            {PHONE_TEXT_KINDS.map((k) => {
              const value = texts[k] ?? "";
              const preview = renderPhoneText(
                k,
                SAMPLE[k],
                k === "member_app"
                  ? "https://…/m/abcd1234"
                  : k === "invoice" || k === "payment_due"
                    ? "https://…/invoice/9f2c…"
                    : "",
                { [k]: value },
              );
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
                    {[
                      ...PHONE_TEXT_FIELDS[k],
                      ...(k in { invoice: 1, payment_due: 1, member_app: 1 } ? ["link"] : []),
                    ]
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
