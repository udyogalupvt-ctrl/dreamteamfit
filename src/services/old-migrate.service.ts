/**
 * Old plans as-is: the browser side of /api/old-migrate/* (the single-member carry and the
 * old-software search). The server does the reading and writing; see src/server/old-migrate.ts.
 */
import type { OldDirectoryEntry } from "@/lib/old-data";
import { callServer, getServer } from "@/lib/server-api";

/** Carry one old member's plan as-is (first visit, or the member-page banner). */
/** clientId: pressed on that member's page or sale — carry onto them only, never a new member. */
export const carryOldPlan = (phone: string, oldMemberId: string, planKey = "", clientId = "") =>
  callServer<{ moveId: string; clientId: string; summary: string }>("/api/old-migrate/carry", {
    phone,
    oldMemberId,
    ...(planKey ? { planKey } : {}),
    ...(clientId ? { clientId } : {}),
  });

/** Old-software people for the search box ("Add from old software"). */
export const searchOldSoftware = (q: string) =>
  getServer<{ entries: (OldDirectoryEntry & { clientId: string })[]; today: string }>(
    `/api/old-migrate/search?q=${encodeURIComponent(q)}`,
  );
