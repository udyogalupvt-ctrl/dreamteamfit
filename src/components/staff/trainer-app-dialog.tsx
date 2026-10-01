import { FormDialog } from "@/components/common/form-dialog";
import { TrainerLoginCard } from "@/components/packages/trainer-login-card";
import type { Trainer } from "@/types/models";

/** A trainer's app login (link + password), opened from the Staff page or Packages & Trainers. */
export function TrainerAppDialog({
  trainer,
  onClose,
}: {
  trainer: Trainer | null;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={!!trainer}
      onOpenChange={(o) => !o && onClose()}
      title={`Trainer app · ${trainer?.name ?? ""}`}
      description="Trainers sign in to their own app with a link and password (no gym login needed)."
    >
      {trainer ? <TrainerLoginCard trainer={trainer} /> : null}
    </FormDialog>
  );
}
