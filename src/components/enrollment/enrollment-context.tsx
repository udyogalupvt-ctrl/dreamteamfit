import { createContext, lazy, Suspense, useCallback, useContext, useState, type ReactNode } from "react";
import type { Client } from "@/types/models";
import type { ClientInput } from "@/services/clients.service";

export interface EnrollmentOpenOptions {
  prefill?: Partial<ClientInput>;
  inquiryId?: string | null;
  existingClient?: Client | null;
  resumeEnrollmentId?: string | null;
}

const Ctx = createContext<{ openEnrollment: (o?: EnrollmentOpenOptions) => void } | null>(null);
const EnrollmentWizard = lazy(() => import("./enrollment-wizard").then((m) => ({ default: m.EnrollmentWizard })));

export function EnrollmentProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<EnrollmentOpenOptions | null>(null);
  const [key, setKey] = useState(0);
  const openEnrollment = useCallback((o: EnrollmentOpenOptions = {}) => { setKey((k) => k + 1); setOpts(o); }, []);
  return (
    <Ctx.Provider value={{ openEnrollment }}>
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
