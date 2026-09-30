import { useEffect, useState } from "react";
import { useLive } from "@/hooks/use-live-query";
import {
  DEFAULT_COLOR_THEME,
  LOCAL_KEY,
  applyColorTheme,
  localColorTheme,
  type ColorTheme,
} from "@/lib/theme-colors";
import { subscribeGymColorTheme } from "@/services/appearance.service";

/**
 * The colour theme in force for this login: this device's own choice ("Only me"), else the
 * gym's ("Everyone"), else the default. Applied to the page while the staff app is open.
 */
export function useColorTheme() {
  const gym = useLive<ColorTheme | null>(subscribeGymColorTheme, null, []);
  const [mine, setMine] = useState<ColorTheme | null>(null);
  useEffect(() => {
    const read = () => setMine(localColorTheme());
    read();
    window.addEventListener(LOCAL_KEY, read);
    return () => window.removeEventListener(LOCAL_KEY, read);
  }, []);
  const effective = mine ?? gym.data ?? DEFAULT_COLOR_THEME;
  return { effective, mine, gym: gym.data, loading: gym.loading };
}

/** Keeps the page in the login's colour theme (mounted once in the staff app). */
export function ColorThemeSync() {
  const { effective, loading } = useColorTheme();
  const key = JSON.stringify(effective);
  useEffect(() => {
    if (!loading) applyColorTheme(effective);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loading]);
  return null;
}
