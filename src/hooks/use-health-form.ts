import { useLive } from "@/hooks/use-live-query";
import { defaultHealthForm } from "@/lib/health-form";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { subscribeHealthForm } from "@/services/health-form.service";

/** The saved health form (or the starting draft) plus the gym name it is written for. */
export function useHealthForm() {
  const gym = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const gymName = gym.data.businessName;
  const live = useLive(
    (onData, onError) => subscribeHealthForm(gymName, onData, onError),
    defaultHealthForm(gymName),
    [gymName],
  );
  return { form: live.data, gymName, loading: live.loading };
}
