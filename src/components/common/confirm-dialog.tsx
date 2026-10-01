import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * For something that can't be undone: the confirm button stays off until this word is typed,
   * so it only happens on purpose.
   */
  typeToConfirm?: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  typeToConfirm,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const ok = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.trim().toLowerCase();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-section-title">{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {typeToConfirm ? (
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">
              This can't be undone. Type <b className="font-mono">{typeToConfirm}</b> to confirm.
            </span>
            <Input
              value={typed}
              autoComplete="off"
              aria-label={`Type ${typeToConfirm} to confirm`}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
        ) : null}
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel className={cn(buttonVariants({ variant: "outline" }), "mt-0")}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!ok}
            onClick={(e) => {
              if (!ok) {
                e.preventDefault();
                return;
              }
              onConfirm();
            }}
            className={buttonVariants({ variant: destructive ? "destructive" : "default" })}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
