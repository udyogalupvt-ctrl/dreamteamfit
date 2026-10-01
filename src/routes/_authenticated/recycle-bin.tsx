import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
  CreditCard,
  Package,
  ReceiptIndianRupee,
  RotateCcw,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { SearchInput } from "@/components/common/search-input";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { RECYCLE_BIN_SEEN_KEY as SEEN_KEY } from "@/hooks/use-recycle-bin-badge";
import { useLive } from "@/hooks/use-live-query";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { deleteForever, restoreFromBin, subscribeRecycleBin } from "@/services/recycle-bin.service";
import type { DeleteSection, RecycleBinEntry } from "@/types/models";

export const Route = createFileRoute("/_authenticated/recycle-bin")({
  head: () => ({ meta: [{ title: "Recycle Bin — REBUILD FITNESS" }] }),
  component: RecycleBinPage,
});

const SECTIONS: Record<DeleteSection, { label: string; icon: LucideIcon }> = {
  members: { label: "Members", icon: Users },
  leads: { label: "Leads & follow-ups", icon: UserPlus },
  bills: { label: "Bills", icon: CreditCard },
  packages: { label: "Packages, trainers & plans", icon: Package },
  expenses: { label: "Expenses", icon: ReceiptIndianRupee },
  staff: { label: "Staff", icon: UserCog },
};

function RecycleBinPage() {
  const { user } = useAuth();
  const { owner, role, can } = useAccess();
  // The owner, and logins given the Recycle Bin page, see and restore everything deleted.
  const all = can("recycleBin");
  const viewer = { owner: all, uid: user?.uid ?? "" };
  const live = useLive<RecycleBinEntry[]>(
    user ? (ok, fail) => subscribeRecycleBin(viewer, ok, fail) : null,
    [],
    [all, user?.uid],
  );
  const [section, setSection] = useState<DeleteSection | "all">("all");
  const [search, setSearch] = useState("");
  const [forever, setForever] = useState<RecycleBinEntry | null>(null);
  // Opening the bin counts as having seen what's in it.
  useEffect(() => {
    try {
      localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new Event(SEEN_KEY));
  }, [live.data.length]);

  const by = {
    uid: user?.uid ?? "",
    name: user?.displayName || user?.email || "Owner",
    role,
  };
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return live.data.filter(
      (e) =>
        (section === "all" || e.section === section) &&
        (!q || [e.label, e.detail, e.deletedBy].some((v) => v.toLowerCase().includes(q))),
    );
  }, [live.data, section, search]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    live.data.forEach((e) => m.set(e.section, (m.get(e.section) ?? 0) + 1));
    return m;
  }, [live.data]);

  const restore = async (e: RecycleBinEntry) => {
    try {
      const n = await restoreFromBin(e, by, viewer);
      toast.success("Restored", {
        description: `${e.label} is back${n > 1 ? ` with ${n - 1} record${n === 2 ? "" : "s"} that belonged to it` : ""}.`,
      });
    } catch (err) {
      toast.error("Couldn't restore", { description: firestoreErrorMessage(err) });
    }
  };
  const erase = async (e: RecycleBinEntry) => {
    try {
      await deleteForever(e);
      toast.success("Deleted forever", { description: e.label });
    } catch (err) {
      toast.error("Couldn't delete", { description: firestoreErrorMessage(err) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recycle Bin"
        description="Everything deleted waits here, with who deleted it and when. Restore puts it back exactly as it was; Delete forever can't be undone."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Recycle Bin" }]}
      />
      <div
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
        role="tablist"
        aria-label="What was deleted"
      >
        {(["all", ...Object.keys(SECTIONS)] as (DeleteSection | "all")[]).map((s) => {
          const n = s === "all" ? live.data.length : (counts.get(s) ?? 0);
          if (s !== "all" && !n) return null;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={section === s}
              onClick={() => setSection(s)}
              className={cn(
                "shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold",
                section === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {s === "all" ? "All" : SECTIONS[s].label} · {n}
            </button>
          );
        })}
      </div>
      {live.data.length > 5 ? (
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Find by name, bill number or who deleted it…"
          label="Search the Recycle Bin"
        />
      ) : null}
      {live.loading ? (
        <LoadingRows rows={4} />
      ) : live.error ? (
        <ErrorState error={live.error} title="Couldn't load the Recycle Bin" />
      ) : !rows.length ? (
        <EmptyState
          icon={Trash2}
          title={live.data.length ? "Nothing matches" : "The Recycle Bin is empty"}
          description="When something is deleted it waits here, so it can be put back."
        />
      ) : (
        <ul className="surface-card divide-y divide-border">
          {rows.map((e) => {
            const meta = SECTIONS[e.section] ?? SECTIONS.members;
            const Icon = meta.icon;
            const other = e.deletedByUid !== user?.uid;
            return (
              <li
                key={e.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{e.label}</p>
                    {e.detail ? <p className="text-meta break-words">{e.detail}</p> : null}
                    <p className="text-meta mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>
                        Deleted by <b className="text-foreground">{other ? e.deletedBy : "you"}</b>
                        {other && e.deletedByRole ? ` (${e.deletedByRole})` : ""} ·{" "}
                        {formatDate(e.deletedAt)} ·{" "}
                        {formatDistanceToNow(e.deletedAt, { addSuffix: true })}
                      </span>
                      {other ? <StatusPill tone="warning">By staff</StatusPill> : null}
                      {e.count > 1 ? (
                        <span>
                          · with {e.count - 1} record{e.count === 2 ? "" : "s"} that belonged to it
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => restore(e)}>
                    <RotateCcw aria-hidden /> Restore
                  </Button>
                  {owner ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setForever(e)}
                    >
                      <Trash2 aria-hidden /> Delete forever
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={!!forever}
        onOpenChange={(o) => !o && setForever(null)}
        title={`Delete ${forever?.label ?? ""} forever?`}
        description={
          forever?.section === "members"
            ? "Everything kept for this member is erased, including their saved fingerprint, member app and Member ID (it becomes free for someone new)."
            : "Everything kept for it is erased."
        }
        confirmLabel="Delete forever"
        destructive
        typeToConfirm="DELETE"
        onConfirm={() => {
          const e = forever;
          setForever(null);
          if (e) void erase(e);
        }}
      />
    </div>
  );
}
