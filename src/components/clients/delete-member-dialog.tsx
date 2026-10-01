import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useBin } from "@/hooks/use-bin";
import { binMember } from "@/services/recycle-bin.service";
import type { Client } from "@/types/models";

/** Delete a member: into the Recycle Bin with everything that belongs to them (restorable). */
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
  const bin = useBin();
  const [keepAccounts, setKeepAccounts] = useState(false);

  const remove = async () => {
    const ok = await bin.remove(client.fullName, (by) => binMember(client, { keepAccounts }, by));
    if (!ok) return;
    onOpenChange(false);
    void navigate({ to: "/clients" });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${client.fullName}?`}
      description="They go to the Recycle Bin with everything that belongs to them, and can be restored from there."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => remove()}>
            <Trash2 aria-hidden /> Delete member
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <ul className="list-disc space-y-1 pl-5">
          <li>Profile, plans, PT, visits, calls, bookings and messages leave every list.</li>
          <li>Their thumb stops opening the door; their member app stops working.</li>
          <li>
            Restore brings everything back, and their thumb works again without a new scan.
          </li>
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
      </div>
    </FormDialog>
  );
}
