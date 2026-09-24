import { NAV_ITEMS } from "@/constants/navigation";
import { useAccess } from "@/hooks/use-access";

/** Menu items this login may open. */
export function useNavItems() {
  const { can } = useAccess();
  return NAV_ITEMS.filter((i) => !i.feature || can(i.feature));
}
