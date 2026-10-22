import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ProgressPanel } from "@/components/progress/progress-panel";
import { cleanBodyEntry, putEntry } from "@/lib/body-progress";
import { portalCall } from "@/lib/portal-firebase";
import type { BodyEntry, BodyEntryAuthor, BodyEntryInput } from "@/types/models";

/**
 * A local copy of loaded data that small writes change in place, so the app doesn't reload /me
 * after each one (read cost). It starts over from `base` whenever the app loads fresh data.
 */
export function useEdited<T>(base: T) {
  const [edit, setEdit] = useState<{ base: T; value: T } | null>(null);
  const value = edit && edit.base === base ? edit.value : base;
  const update = useCallback(
    (change: (v: T) => T) =>
      setEdit((e) => ({ base, value: change(e && e.base === base ? e.value : base) })),
    [base],
  );
  return [value, update] as const;
}

/**
 * Body progress in the member app (path /api/portal/body-log) and the trainer app
 * (/api/portal/trainer-body-log with the member's clientId). The server checks who may change what.
 */
export function PortalProgress({
  entries,
  onChange,
  actor,
  today,
  path,
  clientId,
}: {
  entries: BodyEntry[];
  onChange: (change: (list: BodyEntry[]) => BodyEntry[]) => void;
  actor: Pick<BodyEntryAuthor, "kind" | "id">;
  today: string;
  path: string;
  clientId?: string;
}) {
  const save = async (entry: BodyEntryInput, id?: string) => {
    const res = await portalCall<{ ok: boolean; id: string }>(path, {
      clientId,
      action: "save",
      id,
      entry,
    });
    onChange((list) =>
      putEntry(list, { ...entry, id: res.id, by: { ...actor, name: "" }, at: Date.now() }),
    );
  };
  const remove = async (entry: BodyEntry) => {
    try {
      await portalCall(path, { clientId, action: "delete", id: entry.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove it. Try again.");
      return;
    }
    onChange((list) => list.filter((e) => e.id !== entry.id));
    toast("Entry removed", {
      action: {
        label: "Undo",
        onClick: () =>
          void save(cleanBodyEntry(entry)).catch((e: unknown) =>
            toast.error(e instanceof Error ? e.message : "Couldn't put it back."),
          ),
      },
    });
  };
  return (
    <ProgressPanel
      entries={entries}
      actor={actor}
      today={today}
      canAdd
      onSave={save}
      onDelete={remove}
    />
  );
}
