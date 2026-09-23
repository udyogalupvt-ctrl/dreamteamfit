import { useEffect, useState, type ReactNode } from "react";
import { DesktopSidebar } from "@/components/layout/sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-nav";
import { Topbar } from "@/components/layout/topbar";

const COLLAPSE_KEY = "forge-sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "true");
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      window.localStorage.setItem(COLLAPSE_KEY, String(!prev));
      return !prev;
    });
  };

  return (
    <div className="flex min-h-dvh bg-background">
      <DesktopSidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <Topbar />
        <main
          id="main"
          className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pb-10"
        >
          <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">{children}</div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
