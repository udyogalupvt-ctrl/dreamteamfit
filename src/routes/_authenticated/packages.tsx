import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal, Package, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { StatusPill } from "@/components/common/status-pill";
import { PackageFormDialog } from "@/components/packages/package-form-dialog";
import { PtPackagesSection, TrainersSection } from "@/components/packages/pt-trainer-sections";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLive } from "@/hooks/use-live-query";
import { formatDate, formatDuration, formatPrice } from "@/lib/format";
import { deletePackage, subscribePackages, updatePackage } from "@/services/packages.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { GymPackage } from "@/types/models";

export const Route = createFileRoute("/_authenticated/packages")({
  head: () => ({
    meta: [
      { title: "Packages — REBUILD FITNESS" },
      { name: "description", content: "Create and manage membership packages and pricing." },
      { property: "og:title", content: "Packages — REBUILD FITNESS" },
      { property: "og:description", content: "Create and manage membership packages and pricing." },
    ],
  }),
  component: PackagesPage,
});

type StatusFilter = "all" | "active" | "inactive";

function PackagesPage() {
  const [section, setSection] = useState<"gym" | "pt" | "trainers">("gym");
  return (
    <div className="space-y-5">
      <Tabs value={section} onValueChange={(v) => setSection(v as typeof section)}>
        <TabsList><TabsTrigger value="gym">Gym packages</TabsTrigger><TabsTrigger value="pt">PT packages</TabsTrigger><TabsTrigger value="trainers">Trainers</TabsTrigger></TabsList>
      </Tabs>
      {section === "gym" ? <GymPackagesSection /> : section === "pt" ? <PtPackagesSection /> : <TrainersSection />}
    </div>
  );
}

function GymPackagesSection() {
  const { data, loading, error } = useLive<GymPackage[]>(subscribePackages, [], []);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GymPackage | null>(null);
  const [viewing, setViewing] = useState<GymPackage | null>(null);
  const [deleting, setDeleting] = useState<GymPackage | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter(
      (p) =>
        (status === "all" || (status === "active" ? p.isActive : !p.isActive)) &&
        (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)),
    );
  }, [data, search, status]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (p: GymPackage) => {
    setEditing(p);
    setFormOpen(true);
  };
  const toggleActive = async (p: GymPackage) => {
    try {
      await updatePackage(p.id, { isActive: !p.isActive });
      toast.success(p.isActive ? "Package deactivated" : "Package activated", {
        description: p.name,
      });
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await deletePackage(target.id);
      toast.success("Package deleted", { description: target.name });
      if (viewing?.id === target.id) setViewing(null);
    } catch (err) {
      toast.error(firestoreErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Packages"
        description="Gym memberships, PT packages and trainers — prices set by the admin."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Packages" }]}
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden /> New package
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search packages…"
          label="Search packages"
          containerClassName="sm:max-w-sm"
        />
        <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="inactive">Inactive</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <LoadingRows rows={4} />
      ) : error ? (
        <ErrorState error={error} title="Couldn't load packages" />
      ) : data.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No packages yet"
          description="Create a membership package to get started."
          action={
            <Button onClick={openCreate}>
              <Plus aria-hidden /> Create package
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No matching packages"
          description="Try a different search or filter."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <article
              key={p.id}
              className="surface-card group flex min-w-0 flex-col p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setViewing(p)}
                  className="min-w-0 cursor-pointer rounded text-left"
                >
                  <h2 className="text-card-title truncate">{p.name}</h2>
                  <p className="text-meta mt-0.5">
                    {p.category} · {p.durationDays} days · {formatDuration(p.durationDays)}
                  </p>
                </button>
                <PackageActions
                  pkg={p}
                  onView={() => setViewing(p)}
                  onEdit={() => openEdit(p)}
                  onToggle={() => void toggleActive(p)}
                  onDelete={() => setDeleting(p)}
                />
              </div>
              <p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                {p.description || "No description"}
              </p>
              <div className="mt-4 flex items-end justify-between gap-3">
                <p className="text-stat">{formatPrice(p.price)}</p>
                <StatusPill tone={p.isActive ? "success" : "warning"}>
                  {p.isActive ? "Active" : "Inactive"}
                </StatusPill>
              </div>
            </article>
          ))}
        </div>
      )}

      <PackageFormDialog open={formOpen} onOpenChange={setFormOpen} pkg={editing} />

      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {viewing ? (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="text-section-title">{viewing.name}</SheetTitle>
                <SheetDescription>{viewing.description || "No description"}</SheetDescription>
              </SheetHeader>
              <dl className="mt-6 grid grid-cols-2 gap-3 px-4">
                {[
                  ["Price", formatPrice(viewing.price)],
                  ["Duration", `${viewing.durationDays} days`],
                  ["Status", viewing.isActive ? "Active" : "Inactive"],
                  ["Created", formatDate(viewing.createdAt)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-border bg-muted/40 p-3">
                    <dt className="text-meta">{k}</dt>
                    <dd className="mt-1 font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6 flex flex-wrap gap-2 px-4">
                <Button onClick={() => openEdit(viewing)}>
                  <Pencil aria-hidden /> Edit
                </Button>
                <Button variant="outline" onClick={() => void toggleActive(viewing).then(() => setViewing(null))}>
                  <Power aria-hidden /> {viewing.isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "package"}?`}
        description="This permanently removes the package. Packages used by memberships can't be deleted — deactivate them instead."
        confirmLabel="Delete package"
        destructive
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function PackageActions({
  pkg,
  onView,
  onEdit,
  onToggle,
  onDelete,
}: {
  pkg: GymPackage;
  onView: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${pkg.name}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={onView}>
          <Package aria-hidden /> View details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil aria-hidden /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggle}>
          <Power aria-hidden /> {pkg.isActive ? "Deactivate" : "Activate"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 aria-hidden /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
