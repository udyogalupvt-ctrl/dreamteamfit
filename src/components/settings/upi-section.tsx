import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/common/form-dialog";
import { FormSection } from "@/components/common/form-section";
import { UpiQr } from "@/components/pay/upi-qr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { PAY_LIMITS, upiUri, validateUpiSettings } from "@/lib/pay-links";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { saveUpiSettings, subscribeUpiSettings } from "@/services/pay-links.service";

/**
 * Settings → Gym & bills: the gym's UPI ID. With it set, members can pay a bill's balance or renew
 * from their app or bill link; the desk confirms each payment (Billing → Paid online). Owner only:
 * whoever sets it decides where members' money goes.
 */
export function UpiSection() {
  const id = useId();
  const { owner } = useAccess();
  const live = useLive(subscribeUpiSettings, { upiId: "", payeeName: "", updatedBy: "" }, []);
  const saved = live.data;
  const [upiId, setUpiId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setUpiId(saved.upiId);
    setPayeeName(saved.payeeName);
  }, [saved.upiId, saved.payeeName]);
  const check = validateUpiSettings({ upiId, payeeName });
  const touched = upiId.trim() !== "" || payeeName.trim() !== "";
  const err = (field: "upiId" | "payeeName") =>
    touched && !check.ok && check.field === field ? check.error : undefined;
  const same =
    check.ok &&
    check.upiId === saved.upiId &&
    (check.upiId ? check.payeeName : "") === saved.payeeName;
  const save = async (value: { upiId: string; payeeName: string }) => {
    setBusy(true);
    try {
      await saveUpiSettings(value);
      toast.success(value.upiId.trim() ? "UPI ID saved" : "Online payment switched off");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormSection
      title="Online payment (UPI)"
      description="Members pay a bill's balance, or renew, by UPI from their app or bill link, straight to this account. Nothing counts as paid until the desk confirms it in Billing."
      footer={
        owner ? (
          <>
            {saved.upiId ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void save({ upiId: "", payeeName: "" })}
              >
                Switch off
              </Button>
            ) : null}
            <Button
              disabled={busy || live.loading || !check.ok || same || !check.upiId}
              onClick={() => void save({ upiId, payeeName })}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save
            </Button>
          </>
        ) : undefined
      }
    >
      {!owner ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Only the owner can change the gym's UPI ID.
        </p>
      ) : null}
      <fieldset disabled={!owner || live.loading} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field
          label="Gym's UPI ID"
          htmlFor={`${id}-upi`}
          error={err("upiId")}
          hint="Use the gym's business (merchant) UPI ID. Some UPI apps don't open pay links to a personal UPI ID; scanning the QR still works."
        >
          <Input
            id={`${id}-upi`}
            value={upiId}
            maxLength={PAY_LIMITS.upiId}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setUpiId(e.target.value)}
            placeholder="gymname@okhdfcbank"
            aria-invalid={!!err("upiId")}
          />
        </Field>
        <Field
          label="Name members see"
          htmlFor={`${id}-name`}
          error={err("payeeName")}
          hint="Usually the name on the bank account."
        >
          <Input
            id={`${id}-name`}
            value={payeeName}
            maxLength={PAY_LIMITS.payeeName}
            onChange={(e) => setPayeeName(e.target.value)}
            placeholder="Business name"
            aria-invalid={!!err("payeeName")}
          />
        </Field>
      </fieldset>
      {saved.upiId ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-center">
          <UpiQr
            uri={upiUri({
              upiId: saved.upiId,
              payeeName: saved.payeeName,
              amount: 1,
              note: "Test",
            })}
            label={`Test QR for ₹1 to ${saved.upiId}`}
            className="size-36 shrink-0 self-center border border-border"
          />
          <div className="grid gap-1.5 text-sm">
            <p className="font-medium">Check it before members pay</p>
            <p className="text-muted-foreground">
              Scan this ₹1 test QR with any UPI app. It should show the gym's bank account name for{" "}
              <span className="font-medium text-foreground break-all">{saved.upiId}</span>. If it
              shows another name, fix the UPI ID before members use it. You don't need to pay.
            </p>
            {saved.updatedBy ? (
              <p className="text-meta">Last changed by {saved.updatedBy}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-meta">Off: members don't see any Pay button until a UPI ID is saved.</p>
      )}
    </FormSection>
  );
}
