/**
 * Colour theme (Settings → Appearance): the main colour for light mode and for dark mode, and a
 * light or dark menu in light mode. Chosen for one device ("Only me") or by the owner for every
 * login ("Everyone", settings/appearance). Applied as CSS variables over styles.css; the last one
 * used is kept on the device so the next visit paints in it straight away.
 */
export const ACCENT_IDS = ["yellow", "blue", "green", "orange", "violet", "rose", "teal"] as const;
export type AccentId = (typeof ACCENT_IDS)[number];
export type MenuStyle = "light" | "dark";

export interface ColorTheme {
  light: { accent: AccentId; menu: MenuStyle };
  dark: { accent: AccentId };
}
export const DEFAULT_COLOR_THEME: ColorTheme = {
  light: { accent: "yellow", menu: "light" },
  dark: { accent: "yellow" },
};

type Vars = Record<string, string>;
const palette = (
  label: string,
  swatch: string,
  light: [primary: string, fg: string, ring: string, accent: string, accentFg: string],
  dark: [primary: string, fg: string, accent: string, accentFg: string],
) => ({
  label,
  swatch,
  light: {
    "--primary": light[0],
    "--primary-foreground": light[1],
    "--ring": light[2],
    "--accent": light[3],
    "--accent-foreground": light[4],
    "--sidebar-primary": light[0],
    "--sidebar-primary-foreground": light[1],
    "--sidebar-ring": light[2],
    "--chart-1": light[0],
  } as Vars,
  dark: {
    "--primary": dark[0],
    "--primary-foreground": dark[1],
    "--ring": `${dark[0].replace(")", "")} / 70%)`,
    "--accent": dark[2],
    "--accent-foreground": dark[3],
    "--sidebar-primary": dark[0],
    "--sidebar-primary-foreground": dark[1],
    "--sidebar-ring": `${dark[0].replace(")", "")} / 70%)`,
    "--chart-1": dark[0],
  } as Vars,
});

export const ACCENTS: Record<AccentId, ReturnType<typeof palette>> = {
  yellow: palette(
    "Gym yellow",
    "#f5d90a",
    [
      "oklch(0.88 0.19 101)",
      "oklch(0.16 0.02 90)",
      "oklch(0.72 0.16 101)",
      "oklch(0.95 0.045 101)",
      "oklch(0.22 0.025 90)",
    ],
    ["oklch(0.89 0.19 101)", "oklch(0.15 0.02 90)", "oklch(0.3 0.035 101)", "oklch(0.94 0.14 101)"],
  ),
  blue: palette(
    "Blue",
    "#2f6fe4",
    [
      "oklch(0.55 0.2 260)",
      "oklch(0.99 0 0)",
      "oklch(0.6 0.18 260)",
      "oklch(0.95 0.03 260)",
      "oklch(0.3 0.1 260)",
    ],
    ["oklch(0.7 0.16 255)", "oklch(0.15 0.03 260)", "oklch(0.3 0.06 260)", "oklch(0.9 0.08 255)"],
  ),
  green: palette(
    "Green",
    "#1f9d55",
    [
      "oklch(0.58 0.16 150)",
      "oklch(0.99 0 0)",
      "oklch(0.64 0.15 150)",
      "oklch(0.95 0.04 150)",
      "oklch(0.3 0.08 150)",
    ],
    ["oklch(0.75 0.17 152)", "oklch(0.16 0.03 150)", "oklch(0.3 0.05 150)", "oklch(0.9 0.1 150)"],
  ),
  orange: palette(
    "Orange",
    "#f07b1d",
    [
      "oklch(0.72 0.18 55)",
      "oklch(0.18 0.03 50)",
      "oklch(0.7 0.17 55)",
      "oklch(0.95 0.04 60)",
      "oklch(0.3 0.08 50)",
    ],
    ["oklch(0.76 0.16 58)", "oklch(0.16 0.03 50)", "oklch(0.3 0.06 55)", "oklch(0.9 0.1 60)"],
  ),
  violet: palette(
    "Violet",
    "#7c4ddb",
    [
      "oklch(0.55 0.21 295)",
      "oklch(0.99 0 0)",
      "oklch(0.6 0.2 295)",
      "oklch(0.95 0.03 295)",
      "oklch(0.3 0.1 295)",
    ],
    ["oklch(0.72 0.17 295)", "oklch(0.15 0.03 295)", "oklch(0.3 0.07 295)", "oklch(0.9 0.08 295)"],
  ),
  rose: palette(
    "Red",
    "#e0345a",
    [
      "oklch(0.6 0.21 15)",
      "oklch(0.99 0 0)",
      "oklch(0.62 0.2 15)",
      "oklch(0.95 0.03 15)",
      "oklch(0.32 0.1 15)",
    ],
    ["oklch(0.7 0.18 15)", "oklch(0.15 0.03 15)", "oklch(0.3 0.07 15)", "oklch(0.9 0.08 15)"],
  ),
  teal: palette(
    "Teal",
    "#0f9b9b",
    [
      "oklch(0.6 0.11 195)",
      "oklch(0.99 0 0)",
      "oklch(0.62 0.1 195)",
      "oklch(0.95 0.03 195)",
      "oklch(0.3 0.06 195)",
    ],
    ["oklch(0.75 0.12 190)", "oklch(0.15 0.03 190)", "oklch(0.3 0.05 190)", "oklch(0.9 0.07 190)"],
  ),
};

/**
 * Light mode with the dark menu (the original look): the menu gets every dark-mode colour
 * (styles.css .dark), not only its background, so its name, user, switches and anything added
 * later stay readable on it.
 */
const DARK_MENU: Vars = {
  "--background": "oklch(0.16 0.006 90)",
  "--foreground": "oklch(0.965 0.004 260)",
  "--surface": "oklch(0.205 0.007 90)",
  "--surface-foreground": "oklch(0.965 0.004 260)",
  "--elevated": "oklch(0.245 0.009 90)",
  "--card": "oklch(0.205 0.007 90)",
  "--card-foreground": "oklch(0.965 0.004 260)",
  "--popover": "oklch(0.22 0.008 90)",
  "--popover-foreground": "oklch(0.965 0.004 260)",
  "--secondary": "oklch(0.27 0.011 265)",
  "--secondary-foreground": "oklch(0.95 0.004 260)",
  "--muted": "oklch(0.26 0.01 265)",
  "--muted-foreground": "oklch(0.72 0.015 262)",
  "--subtle": "oklch(0.6 0.015 262)",
  "--destructive": "oklch(0.67 0.2 24)",
  "--success": "oklch(0.75 0.17 152)",
  "--warning": "oklch(0.82 0.17 75)",
  "--info": "oklch(0.7 0.15 250)",
  "--success-text": "oklch(0.75 0.17 152)",
  "--warning-text": "oklch(0.82 0.17 75)",
  "--border": "oklch(1 0 0 / 10%)",
  "--input": "oklch(1 0 0 / 14%)",
  "--sidebar": "oklch(0.14 0.005 90)",
  "--sidebar-foreground": "oklch(0.93 0.004 260)",
  "--sidebar-accent": "oklch(0.235 0.012 90)",
  "--sidebar-accent-foreground": "oklch(0.97 0.004 260)",
  "--sidebar-border": "oklch(1 0 0 / 10%)",
  "--elevation-1": "0 1px 2px oklch(0 0 0 / 0.4)",
  "color-scheme": "dark",
  color: "var(--foreground)",
};
/** The menus (desktop sidebar, phone drawer) carry data-app-menu. */
const MENU = "html:not(.dark) [data-app-menu]";

const isAccent = (v: unknown): v is AccentId => ACCENT_IDS.includes(v as AccentId);
/** Anything read from storage / the database, made safe. */
export function cleanColorTheme(x: unknown): ColorTheme {
  const t = (x ?? {}) as {
    light?: { accent?: unknown; menu?: unknown };
    dark?: { accent?: unknown };
  };
  return {
    light: {
      accent: isAccent(t.light?.accent) ? t.light.accent : "yellow",
      menu: t.light?.menu === "dark" ? "dark" : "light",
    },
    dark: { accent: isAccent(t.dark?.accent) ? t.dark.accent : "yellow" },
  };
}

const block = (selector: string, vars: Vars) =>
  `${selector}{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;

/** The CSS that turns styles.css's yellow theme into this one ("" for the default). */
export function colorThemeCss(t: ColorTheme) {
  // :root first, .dark after it: in dark mode both match and the dark values win.
  const css =
    block(":root", ACCENTS[t.light.accent].light) + block(".dark", ACCENTS[t.dark.accent].dark);
  // Dark menu in light mode: the light-mode colour, in its dark-background shade.
  return t.light.menu === "dark"
    ? css + block(MENU, { ...DARK_MENU, ...ACCENTS[t.light.accent].dark })
    : css;
}

const STYLE_ID = "rf-color-theme";
export const LOCAL_KEY = "rf-color-theme";
/** The CSS last used on this device, painted before the app loads (no flash of yellow). */
export const CSS_CACHE_KEY = "rf-color-css";

export function applyColorTheme(t: ColorTheme) {
  if (typeof document === "undefined") return;
  const css = colorThemeCss(t);
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
  try {
    localStorage.setItem(CSS_CACHE_KEY, css);
  } catch {
    /* storage blocked */
  }
}

/** "Only me": this device's own choice (null = use the gym's). */
export function localColorTheme(): ColorTheme | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? cleanColorTheme(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function setLocalColorTheme(t: ColorTheme | null) {
  try {
    if (t) localStorage.setItem(LOCAL_KEY, JSON.stringify(t));
    else localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event(LOCAL_KEY));
}

/** Inline script: paints the last used colours before first paint. */
export const colorThemeBootstrapScript = `(function(){try{var c=localStorage.getItem('${CSS_CACHE_KEY}');if(c){var s=document.createElement('style');s.id='${STYLE_ID}';s.textContent=c;document.head.appendChild(s);}}catch(e){}})();`;
