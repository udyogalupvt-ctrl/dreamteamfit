import type { LucideIcon } from "lucide-react";
import { Hammer } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";

interface ModulePlaceholderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  capabilities: string[];
}

/** Shell-ready page used by modules whose business logic ships in a later stage. */
export function ModulePlaceholder({
  title,
  description,
  icon,
  capabilities,
}: ModulePlaceholderProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: title }]}
        actions={<Badge variant="secondary">Not available yet</Badge>}
      />

      <EmptyState
        icon={icon}
        title={`${title} is not available yet`}
        description="This area will become available when its data module is enabled."
      />

      <section className="surface-card p-5">
        <div className="flex items-center gap-2">
          <Hammer className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-card-title">Planned capabilities</h2>
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {capabilities.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
