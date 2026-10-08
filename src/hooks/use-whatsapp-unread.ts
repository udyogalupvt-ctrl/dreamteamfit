import { useAccess } from "@/hooks/use-access";
import { useLive } from "@/hooks/use-live-query";
import { subscribeUnreadChats, type WaChat } from "@/services/whatsapp-chats.service";

/** Menu badge: how many WhatsApp chats have unread messages (logins with WhatsApp chats only). */
export function useWhatsAppUnread() {
  const { can } = useAccess();
  const allowed = can("whatsappChats");
  const live = useLive<WaChat[]>(allowed ? subscribeUnreadChats : null, [], [allowed]);
  return live.data.length;
}
