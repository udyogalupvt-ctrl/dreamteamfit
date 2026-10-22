import { Gift, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PortalReferrals } from "@/constants/portal";
import { formatDateISO } from "@/lib/format";
import { shareText, whatsappShareUrl } from "@/lib/referrals";

/**
 * Member app Home: "Bring a friend". The message only says who sent them; rewards are the gym's
 * call, so the card lists the ones already decided and promises nothing.
 */
export function BringFriendCard({
  referrals,
  gymName,
  name,
  memberId,
}: {
  referrals: PortalReferrals;
  gymName: string;
  name: string;
  memberId: string;
}) {
  const text = shareText(gymName, name, memberId);
  return (
    <section className="surface-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet text-white">
          <Gift className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Bring a friend</h2>
          <p className="text-meta">
            Send them a message. When they join, the desk notes that you sent them.
          </p>
        </div>
      </div>
      {referrals.count ? (
        <p className="mt-3 text-sm">
          Friends who joined through you:{" "}
          <span className="font-bold tabular-nums">{referrals.count}</span>
        </p>
      ) : null}
      {referrals.rewards.length ? (
        <ul aria-label="Your rewards" className="mt-2 space-y-1.5 text-sm">
          {referrals.rewards.map((r, i) => (
            <li key={i} className="rounded-lg bg-muted px-3 py-2">
              <span className="font-semibold">{r.label}</span>
              <span className="block text-meta">
                For bringing {r.friend || "a friend"} ·{" "}
                {r.status === "given"
                  ? `Given ${formatDateISO(r.givenOn)}`
                  : "At your next renewal"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Button asChild size="sm" className="mt-3">
        <a href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer">
          <MessageCircle aria-hidden /> Invite on WhatsApp
        </a>
      </Button>
    </section>
  );
}
