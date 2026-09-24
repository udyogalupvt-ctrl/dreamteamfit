import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhotoLinkButtons } from "@/components/clients/photo-link-button";
import { Link } from "@tanstack/react-router";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/common/form-dialog";
import { ImageUpload } from "@/components/common/image-upload";
import { StatusPill } from "@/components/common/status-pill";
import { FingerprintPanel } from "@/components/biometrics/fingerprint-panel";
import { CLOUDINARY_CLIENT_FOLDER } from "@/constants/navigation";
import { useLive } from "@/hooks/use-live-query";
import { useAuth } from "@/hooks/use-auth";
import { SOURCE_LABELS, formatDateISO, formatPrice, normalizePhone, todayISO } from "@/lib/format";
import { getInvoicePublicUrl } from "@/lib/invoice-utils";
import { manualWhatsAppUrl } from "@/lib/invoice-share";
import { cn } from "@/lib/utils";
import { subscribePackages } from "@/services/packages.service";
import {
  calculateShare,
  PT_DURATION_LABELS,
  subscribePtPackages,
  subscribeTrainers,
} from "@/services/pt.service";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import {
  enrollMember,
  enrollmentTotals,
  maxDiscountFor,
  subscribeEnrollment,
} from "@/services/enrollment.service";
import { subscribeStaff } from "@/services/staff.service";
import { useAccess } from "@/hooks/use-access";
import { addDaysISO } from "@/lib/format";
import {
  cleanMemberId,
  findClientsByPhone,
  memberIdLabel,
  memberIdProblem,
  subscribeClient,
  suggestMemberId,
  updateClient,
  type ClientInput,
} from "@/services/clients.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { subscribeInvoice } from "@/services/invoices.service";
import { downloadInvoicePdf } from "@/lib/invoice-download";
import { markInvoiceShared, sendInvoiceWhatsApp } from "@/services/whatsapp.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  isWhatsAppApiLive,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";
import {
  GENDERS,
  LEAD_SOURCES,
  PAYMENT_METHODS,
  type BusinessBillingSettings,
  type Client,
  type Enrollment,
  type Invoice,
  type Membership,
  type PaymentMethod,
  type ShareType,
  type WhatsAppSettings,
} from "@/types/models";
import { daysBetween } from "@/lib/member-plans";
import { subscribeClientMemberships } from "@/services/memberships.service";
import type { EnrollmentOpenOptions } from "./enrollment-context";

const STEPS = ["Details", "Package", "Payment", "Share bill", "Thumb", "Done"] as const;
const DETAILS = 0,
  PACKAGE = 1,
  PAYMENT = 2,
  SHARE = 3,
  THUMB = 4,
  DONE = 5;

const EMPTY: ClientInput = {
  fullName: "",
  phone: "",
  email: "",
  profilePhotoUrl: null,
  dateOfBirth: null,
  gender: "unspecified",
  address: "",
  emergencyContact: "",
  source: "walk_in",
  notes: "",
  status: "active",
};

// ---------------------------------------------------------------- draft (before payment)

interface Draft {
  v: 1;
  step: number;
  client: ClientInput;
  whatsappOptIn: boolean;
  packageId: string;
  ptOn: boolean;
  ptPackageId: string;
  trainerId: string;
  shareOverride: { type: ShareType; value: number } | null;
  startDate: string;
  discount: number;
  amountPaid: number | null;
  method: PaymentMethod;
  notes: string;
  counsellorId?: string;
  nextPaymentDate?: string;
  photoLater?: boolean;
  memberNo?: string;
}

const draftStorageKey = (key: string) => `rf.enrollment-draft.${key}`;
function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(key));
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    return d?.v === 1 ? d : null;
  } catch {
    return null;
  }
}
function writeDraft(key: string, d: Draft | null) {
  try {
    if (d) window.localStorage.setItem(draftStorageKey(key), JSON.stringify(d));
    else window.localStorage.removeItem(draftStorageKey(key));
  } catch {
    /* private mode: drafts just are not kept */
  }
}

// ---------------------------------------------------------------- wizard

export function EnrollmentWizard({
  options,
  onClose,
}: {
  options: EnrollmentOpenOptions;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const existing = options.existingClient ?? null;
  const resuming = Boolean(options.resumeEnrollmentId);
  const draftKey = existing
    ? `client:${existing.id}`
    : options.inquiryId
      ? `inq:${options.inquiryId}`
      : "new";
  const [restored] = useState<Draft | null>(() => (resuming ? null : readDraft(draftKey)));

  const firstStep = existing ? PACKAGE : DETAILS;
  const [step, setStep] = useState(() =>
    resuming ? SHARE : restored ? Math.min(Math.max(restored.step, firstStep), PAYMENT) : firstStep,
  );
  const [client, setClient] = useState<ClientInput>(
    () => restored?.client ?? { ...EMPTY, ...options.prefill },
  );
  const [whatsappOptIn, setWhatsappOptIn] = useState(
    () => restored?.whatsappOptIn ?? existing?.whatsappOptIn ?? true,
  );
  const [packageId, setPackageId] = useState(restored?.packageId ?? "");
  const [ptOn, setPtOn] = useState(restored?.ptOn ?? false);
  const [ptPackageId, setPtPackageId] = useState(restored?.ptPackageId ?? "");
  const [trainerId, setTrainerId] = useState(restored?.trainerId ?? "");
  const [shareOverride, setShareOverride] = useState(restored?.shareOverride ?? null);
  const [startDate, setStartDate] = useState(restored?.startDate ?? todayISO());
  const [discount, setDiscount] = useState(restored?.discount ?? 0);
  const [amountPaid, setAmountPaid] = useState<number | null>(restored?.amountPaid ?? null);
  const [method, setMethod] = useState<PaymentMethod>(restored?.method ?? "UPI");
  const [notes, setNotes] = useState(restored?.notes ?? "");
  const access = useAccess();
  const [counsellorId, setCounsellorId] = useState(
    () => restored?.counsellorId ?? options.counsellorId ?? "",
  );
  const [nextPaymentDate, setNextPaymentDate] = useState(restored?.nextPaymentDate ?? "");
  // Most members send their photo later from their phone, so this starts ticked.
  const [photoLater, setPhotoLater] = useState(restored?.photoLater ?? true);
  const [memberNo, setMemberNo] = useState(restored?.memberNo ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [enrollmentId, setEnrollmentId] = useState<string | null>(
    options.resumeEnrollmentId ?? null,
  );
  const [autoSend, setAutoSend] = useState<AutoSendState>({ kind: "off" });
  const confirmed = Boolean(enrollmentId);

  const packages = useLive(subscribePackages, [], []);
  const ptPackages = useLive(subscribePtPackages, [], []);
  const trainers = useLive(subscribeTrainers, [], []);
  const staffList = useLive(subscribeStaff, [], []);
  // Counsellors first; if nobody is marked counsellor yet, any active staff member can be picked.
  const counsellors = useMemo(() => {
    const active = staffList.data.filter((s) => s.active);
    const marked = active.filter((s) => s.isCounsellor);
    return marked.length ? marked : active;
  }, [staffList.data]);
  // A counsellor signed in on their own login is pre-selected.
  useEffect(() => {
    if (!counsellorId && access.staffId && counsellors.some((c) => c.id === access.staffId))
      setCounsellorId(access.staffId);
  }, [access.staffId, counsellors, counsellorId]);
  const counsellor = counsellors.find((c) => c.id === counsellorId) ?? null;
  const settings = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const enrollment = useLive<Enrollment | null>(
    enrollmentId ? (ok, fail) => subscribeEnrollment(enrollmentId, ok, fail) : null,
    null,
    [enrollmentId],
  );
  const invoiceId = enrollment.data?.invoiceId ?? "";
  const invoice = useLive<Invoice | null>(
    invoiceId ? (ok, fail) => subscribeInvoice(invoiceId, ok, fail) : null,
    null,
    [invoiceId],
  );
  const memberId = enrollment.data?.clientId ?? existing?.id ?? "";
  // A new member gets the next free ID; staff may change it to another free number.
  useEffect(() => {
    if (memberId || memberNo) return;
    void suggestMemberId().then((v) => setMemberNo((n) => n || v));
  }, [memberId, memberNo]);
  const member = useLive<Client | null>(
    memberId ? (ok, fail) => subscribeClient(memberId, ok, fail) : null,
    null,
    [memberId],
  );

  // Resumed setup: jump to the first unfinished step once the enrollment has loaded.
  const resumedOnce = useRef(false);
  useEffect(() => {
    if (!resuming || resumedOnce.current || !enrollment.data) return;
    resumedOnce.current = true;
    const e = enrollment.data;
    setStep(e.status === "active" ? DONE : e.invoiceSharedAt || !e.invoiceId ? THUMB : SHARE);
  }, [resuming, enrollment.data]);
  // Resumed setup can still correct the member's details.
  const loadedMember = useRef(false);
  useEffect(() => {
    if (!resuming || loadedMember.current || !member.data) return;
    loadedMember.current = true;
    const m = member.data;
    setClient({
      fullName: m.fullName,
      phone: m.phone,
      email: m.email,
      profilePhotoUrl: m.profilePhotoUrl,
      dateOfBirth: m.dateOfBirth,
      gender: m.gender,
      address: m.address,
      emergencyContact: m.emergencyContact,
      source: m.source,
      notes: m.notes,
      status: m.status,
    });
    setWhatsappOptIn(m.whatsappOptIn);
  }, [resuming, member.data]);

  const gymPackage = packages.data.find((p) => p.id === packageId) ?? null;

  // Renew or upgrade: an existing member's plans that are still running or already queued.
  const plans = useLive<Membership[]>(
    existing && !resuming ? (ok, fail) => subscribeClientMemberships(existing.id, ok, fail) : null,
    [],
    [existing?.id, resuming],
  );
  const today = todayISO();
  const livePlans = plans.data.filter(
    (m) => !["cancelled", "expired"].includes(m.status) && m.endDate >= today,
  );
  const running = livePlans.find((m) => m.startDate <= today) ?? null;
  const lastEnd = livePlans.reduce((e, m) => (m.endDate > e ? m.endDate : e), "");
  const renewStart = lastEnd ? addDaysISO(lastEnd, 1) : today;
  const unusedDays = running ? Math.max(0, daysBetween(today, running.endDate)) : 0;
  const autoCredit = running
    ? Math.round((running.priceSnapshot * unusedDays) / Math.max(1, running.durationDaysSnapshot))
    : 0;
  const [planMode, setPlanMode] = useState<"renew" | "upgrade">("renew");
  const [creditText, setCreditText] = useState("");
  const upgrading = planMode === "upgrade" && !!running && !!gymPackage;
  const credit = upgrading
    ? Math.max(0, creditText === "" ? autoCredit : Math.floor(Number(creditText) || 0))
    : 0;
  const upgrade = upgrading
    ? {
        membershipId: running.id,
        fromPackage: running.packageNameSnapshot,
        unusedDays,
        credit,
      }
    : null;
  // The start date follows the choice: after the running plan (renew) or today (upgrade / PT only).
  useEffect(() => {
    if (!existing || resuming) return;
    setStartDate(gymPackage && lastEnd && !upgrading ? renewStart : todayISO());
  }, [existing, resuming, gymPackage, lastEnd, upgrading, renewStart]);
  const ptPkg = ptOn ? (ptPackages.data.find((p) => p.id === ptPackageId) ?? null) : null;
  const trainer = ptOn ? (trainers.data.find((t) => t.id === trainerId) ?? null) : null;
  const shareType = shareOverride?.type ?? trainer?.defaultShareType ?? "percentage";
  const shareValue = shareOverride?.value ?? trainer?.defaultTrainerShare ?? 0;
  const pt = useMemo(
    () => (ptPkg && trainer ? { pkg: ptPkg, trainer, shareType, shareValue } : null),
    [ptPkg, trainer, shareType, shareValue],
  );
  const totals = useMemo(
    () =>
      enrollmentTotals({
        gymPackage,
        pt,
        discount,
        amountPaid: amountPaid ?? Number.MAX_SAFE_INTEGER,
        settings: settings.data,
        upgrade,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gymPackage, pt, discount, amountPaid, settings.data, upgrade?.credit, upgrade?.membershipId],
  );
  const paid = amountPaid ?? totals.total;
  const maxDiscount = maxDiscountFor({ gymPackage, pt });
  const balanceLeft = totals.total - Math.min(paid, totals.total) > 0;
  const hasEntry = Boolean(client.fullName || client.phone || packageId || ptOn);

  // Keep an unsaved draft so an accidental close never loses what staff typed.
  useEffect(() => {
    if (confirmed || resuming) return;
    writeDraft(
      draftKey,
      hasEntry
        ? {
            v: 1,
            step,
            client,
            whatsappOptIn,
            packageId,
            ptOn,
            ptPackageId,
            trainerId,
            shareOverride,
            startDate,
            discount,
            amountPaid,
            method,
            notes,
            counsellorId,
            nextPaymentDate,
            photoLater,
            memberNo,
          }
        : null,
    );
  }, [
    confirmed,
    resuming,
    draftKey,
    hasEntry,
    step,
    client,
    whatsappOptIn,
    packageId,
    ptOn,
    ptPackageId,
    trainerId,
    shareOverride,
    startDate,
    discount,
    amountPaid,
    method,
    notes,
    counsellorId,
    nextPaymentDate,
    photoLater,
    memberNo,
  ]);

  const startFresh = () => {
    writeDraft(draftKey, null);
    setClient({ ...EMPTY, ...options.prefill });
    setPackageId("");
    setPtOn(false);
    setPtPackageId("");
    setTrainerId("");
    setShareOverride(null);
    setDiscount(0);
    setAmountPaid(null);
    setNotes("");
    setNextPaymentDate("");
    setPhotoLater(true);
    setMemberNo("");
    setStep(firstStep);
  };

  const validate = async (s: number) => {
    const e: Record<string, string> = {};
    if (s === DETAILS && (!existing || resuming)) {
      if (client.fullName.trim().length < 2) e["fullName"] = "Enter the member's name";
      if (normalizePhone(client.phone).length < 10) e["phone"] = "Enter a 10-digit mobile number";
      if (client.email && !/^\S+@\S+\.\S+$/.test(client.email)) e["email"] = "Invalid email";
      // Every member needs a photo: take it now, or send them the upload link.
      if (!client.profilePhotoUrl && !photoLater)
        e["photo"] = "Take the member's photo, or tick that they will send it from their phone";
      if (!e["phone"]) {
        const dup = (await findClientsByPhone(client.phone)).filter((c) => c.id !== memberId);
        if (dup.length)
          e["phone"] =
            `Already a member: ${dup[0]!.fullName} (${memberIdLabel(dup[0]!.clientCode)})`;
      }
      if (!memberId) {
        const problem = await memberIdProblem(memberNo);
        if (problem) e["memberNo"] = problem;
      }
    }
    if (s === PACKAGE) {
      if (!gymPackage && !ptOn) e["package"] = "Pick a gym package (or turn on personal training)";
      if (ptOn && !ptPkg) e["ptPackage"] = "Pick a PT package";
      if (ptOn && !trainer) e["trainer"] = "Pick a trainer";
      if (counsellors.length && !counsellor) e["counsellor"] = "Pick the counsellor";
    }
    if (s === PAYMENT) {
      if (!gymPackage && !pt) e["package"] = "Pick a package first";
      if (!(paid >= 0) || paid > totals.total)
        e["amountPaid"] = `Enter 0 to ${formatPrice(totals.total)}`;
      if (maxDiscount !== null && discount > maxDiscount)
        e["discount"] = `At most ${formatPrice(maxDiscount)} on this package`;
      if (balanceLeft && !nextPaymentDate) e["nextPaymentDate"] = "When will the rest be paid?";
      else if (balanceLeft && nextPaymentDate < todayISO())
        e["nextPaymentDate"] = "Pick today or a later date";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = async () => {
    if (await validate(step)) setStep((s) => Math.min(s + 1, PAYMENT));
  };

  const confirm = async () => {
    if (!(await validate(DETAILS)) || !(await validate(PACKAGE))) {
      setStep(!existing && (!client.fullName || !client.phone) ? DETAILS : PACKAGE);
      return;
    }
    if (!(await validate(PAYMENT))) return;
    setSaving(true);
    try {
      const r = await enrollMember({
        client,
        whatsappOptIn,
        existingClient: existing,
        inquiryId: options.inquiryId ?? null,
        gymPackage,
        pt,
        startDate,
        discount,
        amountPaid: paid,
        method,
        notes,
        settings: settings.data,
        staff: { uid: user?.uid ?? "", name: user?.displayName || user?.email || "Staff" },
        counsellor: counsellor ? { id: counsellor.id, name: counsellor.name } : null,
        nextPaymentDate: balanceLeft ? nextPaymentDate : null,
        memberId: cleanMemberId(memberNo),
        upgrade,
      });
      writeDraft(draftKey, null);
      setEnrollmentId(r.enrollmentId);
      toast.success("Payment saved and bill created", { description: r.invoice.invoiceNumber });
      setStep(SHARE);
      if (whatsappOptIn && isWhatsAppApiLive(wa.data) && wa.data.autoSendInvoice) {
        setAutoSend({ kind: "sending" });
        sendInvoiceWhatsApp(r.invoice, wa.data, settings.data).then(
          () => setAutoSend({ kind: "sent" }),
          (err: unknown) => setAutoSend({ kind: "failed", message: firestoreErrorMessage(err) }),
        );
      }
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveDetails = async () => {
    if (!memberId || !(await validate(DETAILS))) return;
    setSaving(true);
    try {
      await updateClient(memberId, {
        ...client,
        fullName: client.fullName.trim(),
        phone: client.phone.trim(),
        whatsappOptIn,
        whatsappPhone: client.phone.trim(),
        whatsappStatus: whatsappOptIn ? "ready" : "opted_out",
      });
      toast.success("Details saved");
      setStep(enrollment.data?.invoiceSharedAt ? THUMB : SHARE);
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (!confirmed && hasEntry && !resuming)
      toast.info("Saved as a draft", {
        description: "Tap New member to continue where you left off.",
      });
    else if (confirmed && enrollment.data?.status !== "active")
      toast.info("Setup saved", {
        description: "Finish the thumb from the member's profile anytime.",
      });
    onClose();
  };

  const onRegistered = useCallback(() => setStep((s) => (s === THUMB ? DONE : s)), []);
  const thumbNeeded = !confirmed || enrollment.data?.status !== "active";
  const name = member.data?.fullName ?? existing?.fullName ?? client.fullName;
  const title = resuming
    ? `Finish joining · ${name}`
    : existing
      ? `Renew / add package · ${existing.fullName}`
      : options.inquiryId
        ? "Convert lead to member"
        : "New member";

  const canVisit = (i: number) => {
    if (!confirmed) return i < step && i >= firstStep;
    if (i === DONE) return enrollment.data?.status === "active";
    if (i === DETAILS) return !existing || resuming;
    if (i === SHARE) return Boolean(enrollment.data?.invoiceId);
    return i !== PACKAGE && i !== PAYMENT;
  };

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className={cn(
          "flex max-h-[94dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-3xl",
          "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:h-[94dvh] max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none",
        )}
      >
        <DialogHeader className="border-b border-border px-4 pt-4 pb-3 text-left sm:px-6 sm:pt-5">
          <DialogTitle className="pr-8 text-section-title">{title}</DialogTitle>
          <DialogDescription className="max-sm:sr-only">
            Details → package → payment → bill on WhatsApp → thumb. Nothing is lost if you close.
          </DialogDescription>
          <ol
            className="no-scrollbar -mx-4 mt-2 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0"
            aria-label="Progress"
          >
            {STEPS.map((s, i) => {
              const done = confirmed
                ? i < SHARE ||
                  (i === SHARE && Boolean(enrollment.data?.invoiceSharedAt)) ||
                  (i === THUMB && !thumbNeeded)
                : i < step;
              const visit = canVisit(i) && i !== step;
              return (
                <li key={s}>
                  <button
                    type="button"
                    disabled={!visit}
                    onClick={() => setStep(i)}
                    aria-current={i === step ? "step" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors",
                      i === step
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground",
                      visit && "cursor-pointer hover:ring-2 hover:ring-ring/40",
                    )}
                  >
                    <span className="tabular-nums">
                      {done && i !== step ? <Check className="size-3" /> : i + 1}
                    </span>
                    {s}
                  </button>
                </li>
              );
            })}
          </ol>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {restored && !confirmed && step <= PAYMENT ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-info/40 bg-info/10 px-3 py-2 text-sm">
              <span>
                Continuing your unsaved entry
                {restored.client.fullName ? ` for ${restored.client.fullName}` : ""}.
              </span>
              <Button size="sm" variant="ghost" onClick={startFresh}>
                <RotateCcw aria-hidden /> Start fresh
              </Button>
            </div>
          ) : null}

          {step === DETAILS && (!existing || resuming) ? (
            <DetailsStep
              memberNo={memberId ? null : memberNo}
              setMemberNo={setMemberNo}
              photoLater={photoLater}
              setPhotoLater={setPhotoLater}
              client={client}
              setClient={setClient}
              whatsappOptIn={whatsappOptIn}
              setWhatsappOptIn={setWhatsappOptIn}
              errors={errors}
            />
          ) : null}

          {step === PACKAGE && !confirmed ? (
            <div className="space-y-5">
              {errors["package"] ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {errors["package"]}
                </p>
              ) : null}
              <section className="space-y-3">
                <h3 className="text-card-title">Gym package</h3>
                {packages.data.filter((p) => p.isActive).length === 0 && !packages.loading ? (
                  <p className="text-sm text-muted-foreground">
                    No active gym packages.{" "}
                    <Link to="/packages" className="underline" onClick={close}>
                      Create one in Packages
                    </Link>
                    .
                  </p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                  {packages.data
                    .filter((p) => p.isActive)
                    .map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => setPackageId(packageId === p.id ? "" : p.id)}
                        aria-pressed={packageId === p.id}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors sm:block sm:p-4",
                          packageId === p.id
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "border-border hover:bg-accent",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-bold">{p.name}</span>
                          <span className="text-meta block">
                            {p.category} · {p.durationDays} days
                          </span>
                        </span>
                        <span className="shrink-0 text-lg font-extrabold tabular-nums sm:mt-2 sm:block">
                          {formatPrice(p.price)}
                        </span>
                      </button>
                    ))}
                </div>
                {existing && !resuming && gymPackage && lastEnd ? (
                  <RenewChoice
                    running={running}
                    lastEnd={lastEnd}
                    renewStart={renewStart}
                    unusedDays={unusedDays}
                    autoCredit={autoCredit}
                    mode={planMode}
                    setMode={setPlanMode}
                    creditText={creditText}
                    setCreditText={setCreditText}
                  />
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Start date" htmlFor="e-start">
                    <Input
                      id="e-start"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Counsellor"
                    htmlFor="e-counsellor"
                    required={counsellors.length > 0}
                    error={errors["counsellor"]}
                    hint={
                      counsellors.length
                        ? "Who helped this member join"
                        : "Add staff in Staff to pick a counsellor"
                    }
                  >
                    <Select
                      value={counsellorId}
                      onValueChange={setCounsellorId}
                      disabled={!counsellors.length}
                    >
                      <SelectTrigger id="e-counsellor" className="w-full">
                        <SelectValue placeholder="Select counsellor" />
                      </SelectTrigger>
                      <SelectContent>
                        {counsellors.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border p-3 sm:p-4">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block font-semibold">Add personal training (PT)</span>
                    <span className="text-meta">
                      Trainer and gym share are split automatically.
                    </span>
                  </span>
                  <Switch
                    checked={ptOn}
                    onCheckedChange={setPtOn}
                    aria-label="Add personal training"
                  />
                </label>
                {ptOn ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="PT package"
                      htmlFor="e-ptpkg"
                      required
                      error={errors["ptPackage"]}
                    >
                      <Select value={ptPackageId} onValueChange={setPtPackageId}>
                        <SelectTrigger id="e-ptpkg" className="w-full">
                          <SelectValue placeholder="Select PT package" />
                        </SelectTrigger>
                        <SelectContent>
                          {ptPackages.data
                            .filter((p) => p.isActive)
                            .map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} · {PT_DURATION_LABELS[p.durationType]} ·{" "}
                                {formatPrice(p.price)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Trainer" htmlFor="e-trainer" required error={errors["trainer"]}>
                      <Select
                        value={trainerId}
                        onValueChange={(v) => {
                          setTrainerId(v);
                          setShareOverride(null);
                        }}
                      >
                        <SelectTrigger id="e-trainer" className="w-full">
                          <SelectValue placeholder="Select trainer" />
                        </SelectTrigger>
                        <SelectContent>
                          {trainers.data
                            .filter((t) => t.status === "active")
                            .map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name}
                                {t.specialization ? ` · ${t.specialization}` : ""}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {!ptPackages.data.length || !trainers.data.length ? (
                      <p className="text-meta sm:col-span-2">
                        Add PT packages and trainers in{" "}
                        <Link to="/packages" className="underline" onClick={close}>
                          Packages
                        </Link>
                        .
                      </p>
                    ) : null}
                    {trainer ? (
                      <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                        <Field label="Trainer share" htmlFor="e-sharetype">
                          <Select
                            value={shareType}
                            onValueChange={(v) =>
                              setShareOverride({ type: v as ShareType, value: shareValue })
                            }
                          >
                            <SelectTrigger id="e-sharetype" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="percentage">Percentage</SelectItem>
                              <SelectItem value="fixed">Fixed ₹</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field
                          label={shareType === "percentage" ? "Share %" : "Share ₹"}
                          htmlFor="e-shareval"
                        >
                          <Input
                            id="e-shareval"
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={shareValue}
                            onChange={(e) =>
                              setShareOverride({ type: shareType, value: Number(e.target.value) })
                            }
                          />
                        </Field>
                      </div>
                    ) : null}
                    {ptPkg && trainer
                      ? (() => {
                          const s = calculateShare(ptPkg.price, shareType, shareValue);
                          return (
                            <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-3 text-sm sm:col-span-2">
                              <div>
                                <dt className="text-meta">PT price</dt>
                                <dd className="font-bold tabular-nums">{formatPrice(s.ptPrice)}</dd>
                              </div>
                              <div>
                                <dt className="text-meta">Trainer gets</dt>
                                <dd className="font-bold tabular-nums">
                                  {formatPrice(s.trainerShareAmount)}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-meta">Gym gets</dt>
                                <dd className="font-bold tabular-nums">
                                  {formatPrice(s.gymShareAmount)}
                                </dd>
                              </div>
                            </dl>
                          );
                        })()
                      : null}
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {step === PAYMENT && !confirmed ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div className="space-y-4">
                <div className="rounded-xl border border-border p-3 text-sm sm:p-4">
                  <p className="font-semibold">{existing?.fullName ?? client.fullName}</p>
                  <p className="text-meta">{existing?.phone ?? client.phone}</p>
                  <ul className="mt-3 space-y-1 border-t border-border pt-3">
                    {gymPackage ? (
                      <li className="flex justify-between gap-3">
                        <span>
                          {gymPackage.name} · from {formatDateISO(startDate)}
                        </span>
                        <b className="tabular-nums">{formatPrice(gymPackage.price)}</b>
                      </li>
                    ) : null}
                    {pt ? (
                      <li className="flex justify-between gap-3">
                        <span>
                          PT: {pt.pkg.name} · {pt.trainer.name}
                        </span>
                        <b className="tabular-nums">{formatPrice(pt.pkg.price)}</b>
                      </li>
                    ) : null}
                  </ul>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Amount received ₹"
                    htmlFor="e-paid"
                    error={errors["amountPaid"]}
                    className="col-span-2 sm:col-span-1"
                    hint={
                      paid < totals.total
                        ? `Balance ${formatPrice(totals.total - paid)} stays due`
                        : "Full payment"
                    }
                  >
                    <Input
                      id="e-paid"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={totals.total}
                      value={paid}
                      onChange={(e) =>
                        setAmountPaid(e.target.value === "" ? 0 : Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label="Paid by" htmlFor="e-method" className="col-span-2 sm:col-span-1">
                    <div className="flex flex-wrap gap-1.5" role="radiogroup" id="e-method">
                      {PAYMENT_METHODS.filter((m) => m !== "Other").map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={method === m}
                          onClick={() => setMethod(m)}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-sm font-semibold",
                            method === m
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:bg-accent",
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </Field>
                  {balanceLeft ? (
                    <Field
                      label="Next payment date"
                      htmlFor="e-nextpay"
                      required
                      error={errors["nextPaymentDate"]}
                      className="col-span-2"
                      hint="A WhatsApp reminder goes to the member that morning."
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          id="e-nextpay"
                          type="date"
                          min={todayISO()}
                          value={nextPaymentDate}
                          onChange={(e) => setNextPaymentDate(e.target.value)}
                          className="w-auto"
                        />
                        {[7, 15, 30].map((d) => (
                          <Button
                            key={d}
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setNextPaymentDate(addDaysISO(todayISO(), d))}
                          >
                            +{d} days
                          </Button>
                        ))}
                      </div>
                    </Field>
                  ) : null}
                  <Field
                    label="Discount ₹"
                    htmlFor="e-disc"
                    error={errors["discount"]}
                    hint={maxDiscount !== null ? `Max ${formatPrice(maxDiscount)}` : undefined}
                  >
                    <Input
                      id="e-disc"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={maxDiscount ?? undefined}
                      value={discount}
                      onChange={(e) => setDiscount(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Note on bill" htmlFor="e-inote">
                    <Input
                      id="e-inote"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional"
                    />
                  </Field>
                </div>
              </div>
              <aside className="h-fit rounded-2xl bg-foreground p-4 text-background sm:p-5">
                <dl className="space-y-2 text-sm">
                  {(
                    [
                      ["Subtotal", totals.subtotal],
                      ["Discount", -(totals.discount - totals.upgradeCredit)],
                      ...(totals.upgradeCredit
                        ? [["Upgrade credit", -totals.upgradeCredit] as const]
                        : []),
                      ...(totals.tax ? [["Tax", totals.tax] as const] : []),
                      ["Total", totals.total],
                      ["Received", Math.min(paid, totals.total)],
                      ["Balance", Math.max(0, totals.total - paid)],
                    ] as const
                  ).map(([k, v]) => (
                    <div
                      key={k}
                      className={cn(
                        "flex justify-between",
                        k === "Total" && "border-t border-background/20 pt-2 text-base",
                      )}
                    >
                      <dt>{k}</dt>
                      <dd className="font-bold tabular-nums">{formatPrice(v)}</dd>
                    </div>
                  ))}
                </dl>
              </aside>
            </div>
          ) : null}

          {confirmed && (step === PACKAGE || step === PAYMENT) ? (
            <PaidSummary invoice={invoice.data} />
          ) : null}

          {step === SHARE && confirmed ? (
            <ShareStep
              invoice={invoice.data}
              wa={wa.data}
              business={settings.data}
              autoSend={autoSend}
              setAutoSend={setAutoSend}
            />
          ) : null}

          {step === THUMB && confirmed && memberId ? (
            thumbNeeded ? (
              <FingerprintPanel
                clientId={memberId}
                enrollmentId={enrollmentId}
                onRegistered={onRegistered}
              />
            ) : (
              <p className="rounded-xl border border-success/40 bg-success/10 p-4 text-sm">
                <b>{name}</b>'s thumb is already registered. The new package is active on the same
                thumb.
              </p>
            )
          ) : null}

          {step === DONE ? (
            enrollment.data?.status === "active" ? (
              <div className="grid place-items-center gap-3 py-10 text-center">
                <CheckCircle2 className="size-14 text-success" aria-hidden />
                <p className="text-section-title">All done</p>
                <p className="text-meta max-w-sm">
                  Paid, bill shared, thumb registered. {name} can walk in.
                </p>
              </div>
            ) : (
              <div className="grid place-items-center gap-3 py-10 text-center">
                <ShieldAlert className="size-12 text-warning" aria-hidden />
                <p className="text-section-title">Thumb still pending</p>
                <p className="text-meta max-w-md">
                  Payment and bill are saved. Entry stays blocked until the thumb is registered.
                </p>
              </div>
            )
          ) : null}
          {step === DONE && member.data && !member.data.profilePhotoUrl ? (
            <div className="mx-auto max-w-md space-y-2 rounded-xl border border-warning/50 bg-warning/10 p-4 text-center">
              <p className="font-semibold">Photo still needed</p>
              <p className="text-meta">Send {member.data.fullName} the link to add their photo.</p>
              <div className="flex justify-center">
                <PhotoLinkButtons client={member.data} />
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          {!confirmed ? (
            <>
              {step > firstStep ? (
                <Button variant="outline" size="lg" onClick={() => setStep(step - 1)}>
                  <ChevronLeft aria-hidden /> Back
                </Button>
              ) : (
                <span />
              )}
              {step < PAYMENT ? (
                <Button size="lg" onClick={() => void next()}>
                  Next <ChevronRight aria-hidden />
                </Button>
              ) : (
                <Button
                  size="lg"
                  disabled={saving}
                  onClick={() => void confirm()}
                  className="min-w-0"
                >
                  {saving ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Check aria-hidden />
                  )}
                  <span className="truncate">
                    Confirm payment · {formatPrice(Math.min(paid, totals.total))}
                  </span>
                </Button>
              )}
            </>
          ) : (
            <>
              {step === DONE ? (
                <span />
              ) : (
                <Button variant="ghost" size="lg" onClick={close}>
                  Finish later
                </Button>
              )}
              {step === DETAILS ? (
                <Button size="lg" disabled={saving} onClick={() => void saveDetails()}>
                  {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Save details
                </Button>
              ) : step === PACKAGE || step === PAYMENT ? (
                <Button size="lg" onClick={() => setStep(SHARE)}>
                  Next <ChevronRight aria-hidden />
                </Button>
              ) : step === SHARE ? (
                <Button size="lg" onClick={() => setStep(thumbNeeded ? THUMB : DONE)}>
                  {thumbNeeded ? "Next: thumb" : "Finish"} <ChevronRight aria-hidden />
                </Button>
              ) : step === THUMB ? (
                thumbNeeded ? null : (
                  <Button size="lg" onClick={() => setStep(DONE)}>
                    Finish <ChevronRight aria-hidden />
                  </Button>
                )
              ) : (
                <Button size="lg" onClick={onClose}>
                  Close
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- steps

function DetailsStep({
  memberNo,
  setMemberNo,
  client,
  setClient,
  whatsappOptIn,
  setWhatsappOptIn,
  errors,
  photoLater,
  setPhotoLater,
}: {
  /** null = an existing member (the ID is already given). */
  memberNo: string | null;
  setMemberNo: (v: string) => void;
  client: ClientInput;
  setClient: (c: ClientInput) => void;
  whatsappOptIn: boolean;
  setWhatsappOptIn: (v: boolean) => void;
  errors: Record<string, string>;
  photoLater: boolean;
  setPhotoLater: (v: boolean) => void;
}) {
  const [more, setMore] = useState(
    Boolean(client.email || client.dateOfBirth || client.address || client.emergencyContact),
  );
  // Live check while typing: only free IDs are accepted.
  const [idProblem, setIdProblem] = useState("");
  useEffect(() => {
    if (memberNo === null || !memberNo) return setIdProblem("");
    const t = window.setTimeout(
      () => void memberIdProblem(memberNo).then(setIdProblem, () => setIdProblem("")),
      350,
    );
    return () => window.clearTimeout(t);
  }, [memberNo]);
  const idError = errors["memberNo"] || idProblem;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {memberNo !== null ? (
        <Field
          label="Member ID"
          htmlFor="e-id"
          required
          error={idError}
          hint={
            idError
              ? undefined
              : "Next free number, also used on the fingerprint machine. Change it to keep their old number."
          }
          className="sm:col-span-2 sm:max-w-sm"
        >
          <Input
            id="e-id"
            inputMode="numeric"
            autoComplete="off"
            value={memberNo}
            onChange={(e) => setMemberNo(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </Field>
      ) : null}
      <Field label="Full name" htmlFor="e-name" required error={errors["fullName"]}>
        <Input
          id="e-name"
          autoComplete="off"
          value={client.fullName}
          onChange={(e) => setClient({ ...client, fullName: e.target.value })}
        />
      </Field>
      <Field label="Mobile (WhatsApp)" htmlFor="e-phone" required error={errors["phone"]}>
        <Input
          id="e-phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="98765 43210"
          value={client.phone}
          onChange={(e) => setClient({ ...client, phone: e.target.value })}
        />
      </Field>
      <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm sm:col-span-2">
        <Checkbox
          checked={whatsappOptIn}
          onCheckedChange={(v) => setWhatsappOptIn(v === true)}
          className="mt-0.5"
        />
        <span>
          <span className="block font-semibold">Send bill & reminders on WhatsApp</span>
          <span className="text-meta">
            Member agrees to receive their bill, renewal and birthday messages on this number.
          </span>
        </span>
      </label>
      <div className="space-y-2 sm:col-span-2">
        <ImageUpload
          label="Photo (required)"
          squarePhoto
          folder={CLOUDINARY_CLIENT_FOLDER}
          hint="A clear face photo: take it now, or pick one from the gallery."
          value={
            client.profilePhotoUrl
              ? ({
                  url: client.profilePhotoUrl,
                  publicId: "",
                  width: 0,
                  height: 0,
                  format: "",
                  bytes: 0,
                } as never)
              : null
          }
          onChange={(img) => {
            setClient({ ...client, profilePhotoUrl: img?.url ?? null });
            if (img) setPhotoLater(false);
          }}
        />
        {!client.profilePhotoUrl ? (
          <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <Checkbox
              checked={photoLater}
              onCheckedChange={(v) => setPhotoLater(v === true)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold">
                Member will send the photo from their phone
              </span>
              <span className="text-meta">
                After payment, send them the photo link on WhatsApp.
              </span>
            </span>
          </label>
        ) : null}
        {errors["photo"] ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {errors["photo"]}
          </p>
        ) : null}
      </div>
      <Field label="Gender" htmlFor="e-gender">
        <Select
          value={client.gender}
          onValueChange={(v) => setClient({ ...client, gender: v as ClientInput["gender"] })}
        >
          <SelectTrigger id="e-gender" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GENDERS.map((g) => (
              <SelectItem key={g} value={g} className="capitalize">
                {g === "unspecified" ? "Prefer not to say" : g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="How did they hear about us?" htmlFor="e-source">
        <Select
          value={client.source}
          onValueChange={(v) => setClient({ ...client, source: v as ClientInput["source"] })}
        >
          <SelectTrigger id="e-source" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {more ? (
        <>
          <Field label="Date of birth" htmlFor="e-dob" hint="Used for birthday wishes">
            <Input
              id="e-dob"
              type="date"
              value={client.dateOfBirth ?? ""}
              onChange={(e) => setClient({ ...client, dateOfBirth: e.target.value || null })}
            />
          </Field>
          <Field label="Email" htmlFor="e-email" error={errors["email"]}>
            <Input
              id="e-email"
              type="email"
              value={client.email}
              onChange={(e) => setClient({ ...client, email: e.target.value })}
            />
          </Field>
          <Field label="Emergency contact" htmlFor="e-emg">
            <Input
              id="e-emg"
              value={client.emergencyContact}
              onChange={(e) => setClient({ ...client, emergencyContact: e.target.value })}
            />
          </Field>
          <Field label="Address" htmlFor="e-addr">
            <Input
              id="e-addr"
              value={client.address}
              onChange={(e) => setClient({ ...client, address: e.target.value })}
            />
          </Field>
          <Field label="Notes" htmlFor="e-notes" className="sm:col-span-2">
            <Textarea
              id="e-notes"
              rows={2}
              value={client.notes}
              onChange={(e) => setClient({ ...client, notes: e.target.value })}
            />
          </Field>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="justify-start sm:col-span-2"
          onClick={() => setMore(true)}
        >
          + Add photo, birthday, email, address (optional)
        </Button>
      )}
    </div>
  );
}

function PaidSummary({ invoice }: { invoice: Invoice | null }) {
  if (!invoice) return <Loader2 className="mx-auto animate-spin" aria-label="Loading bill" />;
  return (
    <div className="space-y-3 rounded-xl border border-success/40 bg-success/5 p-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-5 text-success" aria-hidden />
        <p className="font-semibold">Package and payment are saved</p>
      </div>
      {invoice.items.map((i) => (
        <div key={i.name} className="flex justify-between gap-3 text-sm">
          <span>{i.name}</span>
          <span className="tabular-nums">{formatPrice(i.total)}</span>
        </div>
      ))}
      <p className="text-meta">
        Payments are permanent records. To change them, collect the balance or add a new bill in
        Billing.
      </p>
    </div>
  );
}

type AutoSendState =
  { kind: "off" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

function ShareStep({
  invoice,
  wa,
  business,
  autoSend,
  setAutoSend,
}: {
  invoice: Invoice | null;
  wa: WhatsAppSettings;
  business: BusinessBillingSettings;
  autoSend: AutoSendState;
  setAutoSend: (s: AutoSendState) => void;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  if (!invoice)
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="animate-spin" aria-label="Loading bill" />
      </div>
    );
  const live = isWhatsAppApiLive(wa);
  const share = () => {
    window.open(
      manualWhatsAppUrl(invoice, wa.defaultCountryCode, business.businessName),
      "_blank",
      "noopener,noreferrer",
    );
    void markInvoiceShared(invoice).catch(() => undefined);
  };
  const sendApi = async () => {
    setAutoSend({ kind: "sending" });
    try {
      await sendInvoiceWhatsApp(invoice, wa, business);
      setAutoSend({ kind: "sent" });
    } catch (e) {
      setAutoSend({ kind: "failed", message: firestoreErrorMessage(e) });
    }
  };
  const makePdf = async () => {
    setPdfBusy(true);
    try {
      await downloadInvoicePdf(invoice, business);
    } catch (e) {
      toast.error("Couldn't create the PDF", { description: firestoreErrorMessage(e) });
    } finally {
      setPdfBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-lg font-extrabold">{invoice.invoiceNumber}</p>
          <StatusPill tone={invoice.balanceDue ? "warning" : "success"}>
            {invoice.balanceDue ? "Part paid" : "Paid"}
          </StatusPill>
        </div>
        {invoice.items.map((i) => (
          <div key={i.name} className="mt-2 flex justify-between gap-3 text-sm">
            <span>{i.name}</span>
            <span className="tabular-nums">{formatPrice(i.total)}</span>
          </div>
        ))}
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-sm">
          <div>
            <p className="text-meta">Total</p>
            <b>{formatPrice(invoice.total)}</b>
          </div>
          <div>
            <p className="text-meta">Paid</p>
            <b>{formatPrice(invoice.amountPaid)}</b>
          </div>
          <div>
            <p className="text-meta">Balance</p>
            <b>{formatPrice(invoice.balanceDue)}</b>
          </div>
        </div>
      </div>

      {live ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm",
            autoSend.kind === "sent"
              ? "border-success/40 bg-success/10"
              : autoSend.kind === "failed"
                ? "border-destructive/40 bg-destructive/10"
                : "border-border",
          )}
        >
          <span className="flex items-center gap-2">
            {autoSend.kind === "sending" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : autoSend.kind === "sent" ? (
              <CheckCircle2 className="size-4 text-success" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            {autoSend.kind === "sending"
              ? "Sending the bill on WhatsApp…"
              : autoSend.kind === "sent"
                ? `Bill sent to ${invoice.clientPhoneSnapshot} on WhatsApp`
                : autoSend.kind === "failed"
                  ? autoSend.message
                  : "Send the bill automatically through WhatsApp"}
          </span>
          {autoSend.kind !== "sending" && autoSend.kind !== "sent" ? (
            <Button size="sm" onClick={() => void sendApi()}>
              <Send aria-hidden /> {autoSend.kind === "failed" ? "Retry" : "Send now"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {autoSend.kind === "sent" ? (
        // Already delivered by the API: sharing again from this phone would send a second copy.
        <Button size="sm" variant="ghost" className="w-full" onClick={share}>
          <MessageCircle aria-hidden /> Also share from this phone
        </Button>
      ) : (
        <>
          <Button
            size="lg"
            className="h-14 w-full bg-[#25D366] text-base text-white hover:bg-[#1fb857]"
            onClick={share}
          >
            <MessageCircle aria-hidden /> Share bill on WhatsApp
          </Button>
          <p className="text-meta -mt-2 text-center">
            Opens WhatsApp with {invoice.clientPhoneSnapshot} and the bill link ready — just press
            Send.
          </p>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={pdfBusy} onClick={() => void makePdf()}>
          {pdfBusy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}{" "}
          Download PDF
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              .writeText(getInvoicePublicUrl(invoice))
              .then(() => toast.success("Link copied"))
          }
        >
          <Copy aria-hidden /> Copy link
        </Button>
      </div>
    </div>
  );
}

/**
 * An existing member picks a package while a plan is still running: renew after it (nothing
 * lost) or upgrade now (the running plan stops; its unused days are credited on this bill).
 */
function RenewChoice({
  running,
  lastEnd,
  renewStart,
  unusedDays,
  autoCredit,
  mode,
  setMode,
  creditText,
  setCreditText,
}: {
  running: Membership | null;
  lastEnd: string;
  renewStart: string;
  unusedDays: number;
  autoCredit: number;
  mode: "renew" | "upgrade";
  setMode: (m: "renew" | "upgrade") => void;
  creditText: string;
  setCreditText: (v: string) => void;
}) {
  const option = (value: "renew" | "upgrade", title: string, detail: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      onClick={() => setMode(value)}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3 text-left",
        mode === value ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-1 size-4 shrink-0 rounded-full border-2",
          mode === value ? "border-primary bg-primary" : "border-muted-foreground",
        )}
      />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="text-meta">{detail}</span>
      </span>
    </button>
  );
  return (
    <div
      className="space-y-2 rounded-xl border border-border p-3"
      role="radiogroup"
      aria-label="Renew or upgrade"
    >
      <p className="text-sm">
        {running ? (
          <>
            Current plan: <b>{running.packageNameSnapshot}</b>, ends{" "}
            <b>{formatDateISO(running.endDate)}</b> ({unusedDays} day{unusedDays === 1 ? "" : "s"}{" "}
            left)
          </>
        ) : (
          <>
            Already renewed until <b>{formatDateISO(lastEnd)}</b>
          </>
        )}
      </p>
      {option(
        "renew",
        `Renew: starts ${formatDateISO(renewStart)}`,
        "After the current plan ends. The member loses no days.",
      )}
      {running
        ? option(
            "upgrade",
            "Upgrade now: starts today",
            `The current plan stops today; its ${unusedDays} unused days are taken off this bill.`,
          )
        : null}
      {running && mode === "upgrade" ? (
        <Field
          label="Credit for unused days ₹"
          htmlFor="e-credit"
          hint={`₹${running.priceSnapshot.toLocaleString("en-IN")} × ${unusedDays} ÷ ${running.durationDaysSnapshot} days. Change it if the member paid less.`}
        >
          <Input
            id="e-credit"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder={String(autoCredit)}
            value={creditText === "" ? String(autoCredit) : creditText}
            onChange={(e) => setCreditText(e.target.value)}
            className="max-w-40"
          />
        </Field>
      ) : null}
    </div>
  );
}
