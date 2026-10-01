import { useEffect, useRef } from "react";
import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { subscribeTrainers } from "@/services/pt.service";
import { applyStaffTrainerChanges, staffTrainerChanges } from "@/services/staff-trainers.service";
import { subscribeStaff } from "@/services/staff.service";
import type { Staff, Trainer } from "@/types/models";

/**
 * Staff and PT trainers, kept in step: staff with the role "Trainer" get their PT trainer
 * profile, older duplicates are linked by phone, and someone who left stops taking PT. Runs on
 * the Staff page and in Packages & Trainers, for logins that may change trainers.
 */
export function useStaffTrainers() {
  const staff = useLive<Staff[]>(subscribeStaff, [], []);
  const trainers = useLive<Trainer[]>(subscribeTrainers, [], []);
  const { can } = useAccess();
  const allowed = can("packages") || can("staff");
  const busy = useRef(false);
  const ready = !staff.loading && !trainers.loading && !staff.error && !trainers.error;
  useEffect(() => {
    if (!allowed || !ready || busy.current) return;
    const changes = staffTrainerChanges(staff.data, trainers.data);
    if (!changes.length) return;
    busy.current = true;
    void applyStaffTrainerChanges(changes)
      .catch((e: unknown) => console.error("trainer profiles not updated", e))
      .finally(() => {
        busy.current = false;
      });
  }, [allowed, ready, staff.data, trainers.data]);
  return { staff, trainers };
}
