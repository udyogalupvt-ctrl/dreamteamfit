/**
 * Old plans as-is: the browser side of /api/old-migrate/* (the one-time migration on the owner's
 * "Old software check" card, the single-member carry and the old-software search). The server
 * does the reading and writing; see src/server/old-migrate.ts.
 */
import type { OldDirectoryEntry } from "@/lib/old-data";
import { callServer, getServer } from "@/lib/server-api";

/** One member's planned (preview) or applied change. */
export interface MigrateRow {
  phone: string;
  oldMemberId: string;
  name: string;
  clientId: string | null;
  creates: boolean;
  was: string[];
  now: string[];
  carries: number;
  fixes: number;
  recycles: number;
}

export interface MigrateSkip {
  phone: string;
  who: string;
  what: string;
  reason: string;
}

export const previewOldMigrate = (cursor: number) =>
  callServer<{
    rows: MigrateRow[];
    skips: MigrateSkip[];
    next: number | null;
    total: number;
    done: number;
  }>("/api/old-migrate/preview", { cursor });

export const applyOldMigrate = (runId: string, members: { phone: string; oldMemberId: string }[]) =>
  callServer<{
    applied: {
      phone: string;
      oldMemberId: string;
      moveId: string;
      clientId: string;
      summary: string;
    }[];
    skipped: { phone: string; oldMemberId: string; reason: string }[];
    errors: { phone: string; oldMemberId: string; error: string }[];
  }>("/api/old-migrate/apply", { runId, members });

/** Carry one old member's plan as-is (first visit, or the member-page banner). */
export const carryOldPlan = (phone: string, oldMemberId: string, planKey = "") =>
  callServer<{ moveId: string; clientId: string; summary: string }>("/api/old-migrate/carry", {
    phone,
    oldMemberId,
    ...(planKey ? { planKey } : {}),
  });

export const undoOldMigrate = (moveId: string) =>
  callServer<{ ok: true }>("/api/old-migrate/undo", { moveId });

export const undoOldMigrateRun = (runId: string) =>
  callServer<{
    undone: string[];
    errors: { moveId: string; who: string; error: string }[];
    remaining: number;
  }>("/api/old-migrate/undo-run", { runId });

/** Old-software people for the search box ("Add from old software"). */
export const searchOldSoftware = (q: string) =>
  getServer<{ entries: (OldDirectoryEntry & { clientId: string })[]; today: string }>(
    `/api/old-migrate/search?q=${encodeURIComponent(q)}`,
  );
