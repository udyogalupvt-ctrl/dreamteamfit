import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Gift } from "lucide-react";
import { StatusPill } from "@/components/common/status-pill";
import {
  REFERRAL_TONE,
  RewardDialog,
  useReferralActions,
} from "@/components/referrals/reward-dialog";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { formatDateISO } from "@/lib/format";
import { REFERRAL_STATUS_LABELS, rewardLabel } from "@/lib/referrals";
import { cn } from "@/lib/utils";
import { subscribeReferral, subscribeReferralsOf } from "@/services/referrals.service";
import type { Client, Referral } from "@/types/models";

/** Friends this member brought (one shared listener: the SDK reuses identical queries). */
const useFriends = (clientId: string) =>
  useLive<Referral[]>((d, e) => subscribeReferralsOf(clientId, d, e), [], [clientId]);

/** Header pill: a reward was promised to this member (give it at the renewal desk). */
export function ReferralPill({ client, onOpen }: { client: Client; onOpen: () => void }) {
  const promised = useFriends(client.id).data.filter((r) => r.status === "promised").length;
  if (!promised) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="cursor-pointer rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <StatusPill tone="violet">
        {promised === 1 ? "Referral reward promised" : `${promised} referral rewards promised`}
      </StatusPill>
    </button>
  );
}

/** Member profile: who referred them, and the friends they brought with each reward. */
export function MemberReferralsCard({
  client: c,
  className,
}: {
  client: Client;
  className?: string;
}) {
  const { can } = useAccess();
  const canDecide = can("referrals");
  const friends = useFriends(c.id);
  const mine = useLive<Referral | null>(
    c.referredBy ? (d, e) => subscribeReferral(c.id, d, e) : null,
    null,
    [c.id, c.referredBy?.clientId ?? ""],
  );
  const { busy, markGiven } = useReferralActions();
  const [deciding, setDeciding] = useState<Referral | null>(null);
  const first = c.fullName.trim().split(/\s+/)[0] || "they";

  if (friends.loading) return null;
  if (!c.referredBy && !friends.data.length) return null;

  return (
    <section className={cn("surface-card p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-section-title">Referrals</h2>
        <Link to="/referrals" className="text-sm font-medium text-primary hover:underline">
          All referrals
        </Link>
      </div>
      {c.referredBy ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Gift className="size-4 text-primary" aria-hidden />
          <span className="text-muted-foreground">Referred by</span>
          <Link
            to="/clients/$clientId"
            params={{ clientId: c.referredBy.clientId }}
            className="font-semibold hover:underline"
          >
            {c.referredBy.name || "Member"}
          </Link>
          {mine.data ? (
            <StatusPill tone={REFERRAL_TONE[mine.data.status]}>
              {mine.data.reward
                ? `${REFERRAL_STATUS_LABELS[mine.data.status]}: ${rewardLabel(mine.data.reward)}`
                : REFERRAL_STATUS_LABELS[mine.data.status]}
            </StatusPill>
          ) : null}
        </div>
      ) : null}
      {friends.data.length ? (
        <>
          <p className="mt-4 text-meta">
            {friends.data.length === 1
              ? `1 friend joined through ${first}`
              : `${friends.data.length} friends joined through ${first}`}
          </p>
          <ul className="mt-2 divide-y divide-border">
            {friends.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: r.newClientId }}
                    className="block truncate text-sm font-semibold hover:underline"
                  >
                    {r.newClientName || "Member"}
                  </Link>
                  <p className="text-meta tabular-nums">
                    Joined {formatDateISO(r.joinedOn)}
                    {r.reward ? ` · ${rewardLabel(r.reward)}` : ""}
                  </p>
                </div>
                <StatusPill tone={REFERRAL_TONE[r.status]}>
                  {REFERRAL_STATUS_LABELS[r.status]}
                </StatusPill>
                {canDecide && r.status === "due" ? (
                  <Button size="sm" variant="outline" onClick={() => setDeciding(r)}>
                    <Gift aria-hidden /> Record reward
                  </Button>
                ) : null}
                {canDecide && r.status === "promised" ? (
                  <Button size="sm" disabled={busy} onClick={() => void markGiven(r)}>
                    <CheckCircle2 aria-hidden /> Mark given
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {deciding ? (
        <RewardDialog referral={deciding} onOpenChange={(v) => !v && setDeciding(null)} />
      ) : null}
    </section>
  );
}

/** Renewal desk: rewards promised to this member for bringing friends, to hand over now. */
export function PromisedRewardsNote({ clientId }: { clientId: string }) {
  const { can } = useAccess();
  const promised = useFriends(clientId).data.filter((r) => r.status === "promised");
  const { busy, markGiven } = useReferralActions();
  if (!promised.length) return null;
  return (
    <ul
      aria-label="Referral rewards promised"
      className="mt-2 space-y-1 rounded-lg bg-violet/10 px-3 py-2 text-sm ring-1 ring-violet/25 ring-inset"
    >
      {promised.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Gift className="size-4 shrink-0 text-violet" aria-hidden />
          <span className="min-w-0 flex-1">
            Promised: <span className="font-semibold">{rewardLabel(r.reward)}</span> for bringing{" "}
            {r.newClientName.trim().split(/\s+/)[0] || "a friend"}
          </span>
          {can("referrals") ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={busy}
              onClick={() => void markGiven(r)}
            >
              <CheckCircle2 aria-hidden /> Mark given
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
