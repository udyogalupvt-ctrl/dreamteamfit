import { useEffect, useState } from "react";
import { ArchiveRestore, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateISO, formatPrice } from "@/lib/format";
import { oldJoinedOn, oldPhoneKey, runningOldPlan, tidyName, type OldMember } from "@/lib/old-data";
import { lookupOldMembers } from "@/services/old-data.service";

/**
 * Under the phone number while adding a member: finds them in the old software's data (Backup
 * page) and fills in their details, joining date and old member ID in one tap.
 */
export function OldMemberPanel({
  phone,
  linkedId,
  onUse,
  onUnlink,
  onFound,
}: {
  phone: string;
  /** Old member ID already linked ("" = none). */
  linkedId: string;
  onUse: (m: OldMember) => void;
  onUnlink: () => void;
  /** Every lookup result (the wizard keeps the linked one for the plan and payment steps). */
  onFound?: (members: OldMember[], today: string) => void;
}) {
  const key = oldPhoneKey(phone);
  const [state, setState] = useState<{
    key: string;
    loading: boolean;
    members: OldMember[];
    today: string;
    error: string;
  }>({ key: "", loading: false, members: [], today: "", error: "" });

  useEffect(() => {
    if (key.length !== 10) return;
    let live = true;
    setState((s) => ({ ...s, key, loading: true, error: "" }));
    const t = window.setTimeout(() => {
      void lookupOldMembers(key).then(
        (r) => {
          if (!live) return;
          setState({ key, loading: false, members: r.members, today: r.today, error: "" });
          onFound?.(r.members, r.today);
        },
        (e: unknown) =>
          live &&
          setState({
            key,
            loading: false,
            members: [],
            today: "",
            error: e instanceof Error ? e.message : String(e),
          }),
      );
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (key.length !== 10 || state.key !== key) return null;
  if (state.loading)
    return (
      <p className="text-meta flex items-center gap-1.5 sm:col-span-2">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking the old software's data…
      </p>
    );
  if (state.error || !state.members.length) return null;

  return (
    <div
      className="space-y-2 rounded-xl border border-info/40 bg-info/10 p-3 text-sm sm:col-span-2"
      role="region"
      aria-label="Found in the old software"
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <ArchiveRestore className="size-4" aria-hidden />
        {state.members.length === 1
          ? "This number is in the old software"
          : `${state.members.length} people use this number in the old software`}
      </p>
      {state.members.map((m) => {
        const linked = linkedId === m.memberId;
        const last = m.plans[0];
        const running = state.today ? runningOldPlan(m, state.today) : null;
        return (
          <div
            key={m.memberId || m.name}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/70 p-2.5"
          >
            <div className="min-w-0">
              <p className="font-semibold">
                {tidyName(m.name)}{" "}
                <span className="font-mono text-xs text-muted-foreground">{m.memberId}</span>
              </p>
              <p className="text-meta">
                Joined {formatDateISO(oldJoinedOn(m))} · {m.plans.length} plan
                {m.plans.length === 1 ? "" : "s"}
                {m.status ? ` · ${m.status}` : ""}
              </p>
              {running ? (
                <p className="text-meta">
                  Running: <b>{running.name}</b> · {formatDateISO(running.start)} →{" "}
                  {formatDateISO(running.end)}
                  {running.balance > 0 ? ` · balance ${formatPrice(running.balance)}` : ""}
                </p>
              ) : last ? (
                <p className="text-meta">
                  Last plan: {last.name} · ended {formatDateISO(last.end)}
                </p>
              ) : null}
            </div>
            {linked ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 font-semibold text-success">
                  <Check className="size-4" aria-hidden /> Linked
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={onUnlink}>
                  <X aria-hidden /> Not this person
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" onClick={() => onUse(m)}>
                Use old details
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
