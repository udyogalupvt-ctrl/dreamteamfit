import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { Client } from "@/types/models";
import type { ClientInput } from "@/services/clients.service";
import { ensureEnrollmentForClient } from "@/services/enrollment.service";
import { firestoreErrorMessage } from "@/services/firestore.service";

export interface EnrollmentOpenOptions {
  prefill?: Partial<ClientInput>;
  inquiryId?: string | null;
  existingClient?: Client | null;
  resumeEnrollmentId?: string | null;
  /** Counsellor already handling this person (from the lead). */
  counsellorId?: string | null;
}

interface EnrollmentApi {
  openEnrollment: (o?: EnrollmentOpenOptions) => void;
  /** Reopens the joining popup where it stopped (bill sharing / thumb). */
  resumeSetup: (client: Client) => void;
}

const Ctx = createContext<EnrollmentApi | null>(null);
const EnrollmentWizard = lazy(() =>
  import("./enrollment-wizard").then((m) => ({ default: m.EnrollmentWizard })),
);

export function EnrollmentProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<EnrollmentOpenOptions | null>(null);
  const [key, setKey] = useState(0);
  const openEnrollment = useCallback((o: EnrollmentOpenOptions = {}) => {
    setKey((k) => k + 1);
    setOpts(o);
  }, []);
  const resumeSetup = useCallback(
    (client: Client) => {
      void ensureEnrollmentForClient(client).then(
        (id) => openEnrollment({ resumeEnrollmentId: id, existingClient: client }),
        (e: unknown) => toast.error(firestoreErrorMessage(e)),
      );
    },
    [openEnrollment],
  );
  const value = useMemo(() => ({ openEnrollment, resumeSetup }), [openEnrollment, resumeSetup]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {opts ? (
        <Suspense fallback={null}>
          <EnrollmentWizard key={key} options={opts} onClose={() => setOpts(null)} />
        </Suspense>
      ) : null}
    </Ctx.Provider>
  );
}

export function useEnrollment() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useEnrollment must be used inside EnrollmentProvider");
  return c;
}
