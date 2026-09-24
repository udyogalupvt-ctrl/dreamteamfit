import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { formatPrice, todayISO } from "@/lib/format";
import { settleExpense } from "@/services/expenses.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { EXPENSE_PAYMENT_METHODS, type Expense } from "@/types/models";

/** Gym pays back someone who paid an expense from their own pocket. */
export function SettleDialog({
  expense,
  onClose,
}: {
  expense: Expense | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState("Cash");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (expense) {
      setDate(todayISO());
      setMethod("Cash");
    }
  }, [expense]);
  const save = async () => {
    if (!expense || !user) return;
    setSaving(true);
    try {
      await settleExpense(expense, method, date, {
        uid: user.uid,
        name: user.displayName || user.email || "Staff",
      });
      toast.success(`Marked as paid back to ${expense.paidBy}`);
      onClose();
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      open={!!expense}
      onOpenChange={(o) => !o && onClose()}
      title={`Pay back ${expense?.paidBy ?? ""}`}
      description={expense ? `${expense.title} · ${formatPrice(expense.amount)}` : ""}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Mark as paid back
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid back on" htmlFor="st-date">
          <Input id="st-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Paid back by" htmlFor="st-method">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger id="st-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </FormDialog>
  );
}
