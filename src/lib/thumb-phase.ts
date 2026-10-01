import { useEffect, useState } from "react";
import type { BiometricCommand } from "@/types/models";

/** Re-render every few seconds so "online" and "waiting" timers stay honest. */
export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export type Phase =
  | { kind: "idle" }
  | { kind: "waiting_device" }
  | { kind: "place_thumb" }
  | { kind: "confirming" }
  | { kind: "failed"; message: string };

/**
 * Where the registration is. The request just sent is followed by its id: comparing the
 * server's times with this computer's clock fails when the clock is a little off. After a
 * reload, the latest request of the last few minutes.
 */
export function phaseOf(
  commands: BiometricCommand[],
  requestedAfter: number,
  requestId: string | null,
): Phase {
  const enroll = requestId
    ? commands.find((c) => c.id === requestId)
    : commands.find((c) => c.type === "enroll_fp" && c.createdAt.getTime() >= requestedAfter);
  if (!enroll) return requestId ? { kind: "waiting_device" } : { kind: "idle" };
  if (enroll.status === "cancelled") return { kind: "idle" };
  if (enroll.status === "pending") {
    const upsert = commands.find(
      (c) => c.type === "user_upsert" && c.status === "failed" && c.createdAt >= enroll.createdAt,
    );
    if (upsert) return { kind: "failed", message: upsert.error };
    return { kind: "waiting_device" };
  }
  if (enroll.status === "sent") return { kind: "place_thumb" };
  if (enroll.status === "done") return { kind: "confirming" };
  return { kind: "failed", message: enroll.error || "The device could not capture the thumb." };
}
