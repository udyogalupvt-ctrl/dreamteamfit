import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isOwnerEmail } from "@/constants/owners";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "@/lib/firestore";
import { DELETE_FEATURE_OF } from "@/constants/features";
import type { DeleteSection, StaffAccess, StaffFeature } from "@/types/models";

interface AccessValue {
  loading: boolean;
  /** Owner account: everything, including staff logins. */
  owner: boolean;
  /** Owner, or a staff login marked admin: every feature. */
  admin: boolean;
  /** False = login switched off or never set up by an owner. */
  active: boolean;
  staffId: string;
  can: (feature: StaffFeature | "owner") => boolean;
  /**
   * May delete in this section (into the Recycle Bin). Only the owner by default: a staff login
   * needs the section's delete right granted on the Staff page (not included in "All features").
   */
  canDelete: (section: DeleteSection) => boolean;
  /** "Owner" / "Manager" / "Staff", for the Recycle Bin's "deleted by" stamp. */
  role: string;
}

const AccessContext = createContext<AccessValue | null>(null);

/** What the signed-in account may use. Firestore rules enforce the same switches. */
export function AccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const owner = isOwnerEmail(user?.email);
  const [state, setState] = useState<{ loading: boolean; access: StaffAccess | null }>({
    loading: !owner,
    access: null,
  });

  // A dropped connection must not leave a staff login looking switched off: listen again.
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (owner || !user) {
      setState({ loading: false, access: null });
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onSnapshot(
      doc(db, "staffAccess", user.uid),
      (snap) => {
        const d = snap.data();
        setState({
          loading: false,
          access: d
            ? {
                uid: snap.id,
                staffId: String(d["staffId"] ?? ""),
                name: String(d["name"] ?? ""),
                email: String(d["email"] ?? ""),
                active: d["active"] === true,
                admin: d["admin"] === true,
                permissions: Array.isArray(d["permissions"])
                  ? (d["permissions"] as StaffFeature[])
                  : [],
              }
            : null,
        });
      },
      () => {
        setState((s) => (s.access ? s : { loading: false, access: null }));
        timer = setTimeout(() => setRetry((n) => n + 1), 5000);
      },
    );
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [owner, user, retry]);

  const value = useMemo<AccessValue>(() => {
    const a = state.access;
    const active = owner || a?.active === true;
    const admin = owner || (active && a?.admin === true);
    return {
      loading: state.loading,
      owner,
      admin,
      active,
      staffId: a?.staffId ?? "",
      can: (f) => (f === "owner" ? owner : admin || (active && !!a?.permissions.includes(f))),
      canDelete: (section) => {
        const f = DELETE_FEATURE_OF[section];
        return owner || (f !== "owner" && active && !!a?.permissions.includes(f));
      },
      role: owner ? "Owner" : admin ? "Manager" : "Staff",
    };
  }, [owner, state]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used inside AccessProvider");
  return ctx;
}
