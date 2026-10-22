import { useId, useMemo, useState } from "react";
import { Gift, Loader2, Search, X } from "lucide-react";
import { Field } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLive } from "@/hooks/use-live-query";
import { memberMatches } from "@/lib/referrals";
import { subscribeClients } from "@/services/clients.service";
import type { Client, LeadSource, ReferredBy } from "@/types/models";

const asReferrer = (c: Client): ReferredBy => ({
  clientId: c.id,
  name: c.fullName,
  memberCode: c.clientCode,
});

/**
 * "Referred by": search the members (name, member ID or phone) and pick one. The member list
 * loads only once someone starts typing. `locked` explains why the referrer can't change.
 */
export function ReferrerPicker({
  id,
  value,
  onChange,
  excludeId,
  locked = "",
}: {
  id: string;
  value: ReferredBy | null;
  onChange: (v: ReferredBy | null) => void;
  excludeId?: string;
  locked?: string;
}) {
  const [q, setQ] = useState("");
  const [armed, setArmed] = useState(false);
  const listId = useId();
  const clients = useLive<Client[]>(armed ? subscribeClients : null, [], [armed]);
  const hits = useMemo(
    () =>
      q.trim()
        ? clients.data.filter((c) => c.id !== excludeId && memberMatches(c, q)).slice(0, 6)
        : [],
    [clients.data, q, excludeId],
  );

  if (value)
    return (
      <div className="space-y-1">
        <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm">
          <Gift className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{value.name || "Member"}</span>
            {value.memberCode ? (
              <span className="text-muted-foreground"> · #{value.memberCode}</span>
            ) : null}
          </span>
          {!locked && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="-mr-2 size-8"
              aria-label={`Remove ${value.name} as the referrer`}
              onClick={() => onChange(null)}
            >
              <X aria-hidden />
            </Button>
          )}
        </div>
        {locked && <p className="text-meta">{locked}</p>}
      </div>
    );

  const open = q.trim().length > 0;
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={id}
        value={q}
        onFocus={() => setArmed(true)}
        onChange={(e) => {
          setArmed(true);
          setQ(e.target.value);
        }}
        placeholder="Search member: name, ID or phone"
        className="h-10 pl-9"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Members"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {clients.loading ? (
            <p className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading members…
            </p>
          ) : hits.length ? (
            hits.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => {
                  onChange(asReferrer(c));
                  setQ("");
                }}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{c.fullName}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {c.clientCode ? `#${c.clientCode}` : ""}{" "}
                  {c.phone.slice(-4) ? `· …${c.phone.slice(-4)}` : ""}
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              No member matches “{q.trim()}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The "Referred by" field: shown once the source is Referral (or a referrer is already set). */
export function ReferredByField({
  id,
  source,
  value,
  onChange,
  excludeId,
  locked = "",
  className,
}: {
  id: string;
  source: LeadSource;
  value: ReferredBy | null;
  onChange: (v: ReferredBy | null) => void;
  excludeId?: string;
  locked?: string;
  className?: string;
}) {
  if (source !== "referral" && !value) return null;
  return (
    <Field
      label="Referred by"
      htmlFor={id}
      hint={value ? undefined : "The member who sent them. Their reward is decided on Referrals."}
      className={className}
    >
      <ReferrerPicker
        id={id}
        value={value}
        onChange={onChange}
        locked={locked}
        {...(excludeId ? { excludeId } : {})}
      />
    </Field>
  );
}
