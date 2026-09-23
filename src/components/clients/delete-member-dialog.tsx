import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { deleteMemberCompletely } from "@/services/member-delete.service";
import type { Client } from "@/types/models";

export function DeleteMemberDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [keepAccounts, setKeepAccounts] = useState(false);
  const [busy, setBusy] = useState(false);
  const matches = typed.trim().toLowerCase() === client.fullName.trim().toLowerCase();

  const remove = async () => {
    setBusy(true);
    try {
      const r = await deleteMemberCompletely(client, { keepAccounts });
      toast.success(`${client.fullName} deleted`, {
        description: `${r.records} records removed${r.keptAccounts ? " · bills & payments kept" : ""}. The deletion stays in the activity log.`,
      });
      onOpenChange(false);
      void navigate({ to: "/clients" });
    } catch (e) {
      toast.error("Couldn't delete the member", { description: firestoreErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped("");
        onOpenChange(o);
      }}
      title={`Delete ${client.fullName}?`}
      description="This removes the member completely and can't be undone."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!matches || busy} onClick={() => void remove()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}{" "}
            Delete forever
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <ul className="list-disc space-y-1 pl-5">
          <li>Profile, plans, PT, visits, calls, bookings and messages are deleted.</li>
          <li>They are removed from the fingerprint device and their saved thumb is erased.</li>
          <li>The activity log keeps a permanent “Member deleted” line with who did it.</li>
        </ul>
        <label className="flex items-start gap-3 rounded-xl border border-border p-3">
          <Checkbox
            checked={keepAccounts}
            onCheckedChange={(v) => setKeepAccounts(v === true)}
            className="mt-0.5"
          />
          <span>
            <span className="block font-semibold">Keep their bills and payments</span>
            <span className="text-meta">
              Tick this if they paid money, so income reports stay the same.
            </span>
          </span>
        </label>
        <Field label={`Type “${client.fullName}” to confirm`} htmlFor="del-name">
          <Input
            id="del-name"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>
      </div>
    </FormDialog>
  );
}
