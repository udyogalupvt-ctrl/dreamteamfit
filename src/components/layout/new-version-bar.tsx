import { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useNewVersionReady } from "@/lib/app-version";

/** The bottom tab bars (staff app on phones, member / trainer apps): the button sits above them. */
const BOTTOM_BARS = 'nav[aria-label="Quick navigation"], nav[aria-label="Sections"]';

/**
 * Phones and tablets (staff site, installed app, member and trainer apps): when a newer version is
 * live, one "Tap to refresh" button at the bottom centre, above the bottom tab bar and the phone's
 * home bar, within thumb reach. Larger screens use the top bar button instead.
 */
export function NewVersionBar() {
  const ready = useNewVersionReady();
  // Height of the bottom tab bar on this page (it already includes the phone's safe area).
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    if (!ready) return;
    const measure = () => {
      const heights = Array.from(document.querySelectorAll<HTMLElement>(BOTTOM_BARS)).map(
        (n) => n.getBoundingClientRect().height,
      );
      setBarHeight(Math.max(0, ...heights));
    };
    measure();
    window.addEventListener("resize", measure);
    // Pages change (login → app) without a resize.
    const timer = window.setInterval(measure, 1500);
    return () => {
      window.removeEventListener("resize", measure);
      window.clearInterval(timer);
    };
  }, [ready]);
  if (!ready) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[45] flex justify-center px-4 lg:hidden"
      style={{
        bottom: barHeight > 0 ? `${barHeight + 16}px` : "calc(env(safe-area-inset-bottom) + 20px)",
      }}
    >
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="pointer-events-auto inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg ring-4 ring-background transition-transform duration-150 ease-out animate-in fade-in slide-in-from-bottom-2 active:scale-[0.97] motion-reduce:animate-none motion-reduce:transition-none"
      >
        <RefreshCcw className="size-4" aria-hidden />
        New version · Tap to refresh
      </button>
    </div>
  );
}
