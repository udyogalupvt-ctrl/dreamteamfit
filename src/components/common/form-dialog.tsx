import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Centered dialog on desktop, bottom sheet on phones. Body scrolls; footer stays reachable. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-xl",
          "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none",
          className,
        )}
      >
        <DialogHeader className="border-b border-border px-5 pt-5 pb-4 text-left sm:px-6">
          <DialogTitle className="text-section-title">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer ? (
          <DialogFooter className="gap-2 border-t border-border px-5 py-4 max-sm:flex-col-reverse sm:px-6">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-label">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-meta">{hint}</p>
      ) : null}
    </div>
  );
}
