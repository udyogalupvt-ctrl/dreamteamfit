import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Single-column on mobile, label column on desktop. */
export function FormSection({
  title,
  description,
  children,
  footer,
  className,
}: FormSectionProps) {
  return (
    <section className={cn("surface-card overflow-hidden", className)}>
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:p-6">
        <div className="min-w-0">
          <h2 className="text-card-title">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="grid min-w-0 gap-4">{children}</div>
      </div>
      {footer ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
