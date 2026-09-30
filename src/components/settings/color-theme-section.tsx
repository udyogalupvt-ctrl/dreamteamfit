import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormSection } from "@/components/common/form-section";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/use-access";
import { useColorTheme } from "@/hooks/use-color-theme";
import {
  ACCENTS,
  ACCENT_IDS,
  DEFAULT_COLOR_THEME,
  applyColorTheme,
  setLocalColorTheme,
  type AccentId,
  type ColorTheme,
  type MenuStyle,
} from "@/lib/theme-colors";
import { cn } from "@/lib/utils";
import { firestoreErrorMessage } from "@/services/firestore.service";
import { saveGymColorTheme } from "@/services/appearance.service";

function Swatches({
  value,
  onChange,
  label,
}: {
  value: AccentId;
  onChange: (v: AccentId) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {ACCENT_IDS.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          aria-label={ACCENTS[id].label}
          title={ACCENTS[id].label}
          onClick={() => onChange(id)}
          className={cn(
            "grid size-10 cursor-pointer place-items-center rounded-full border-2 transition-transform",
            value === id ? "scale-110 border-foreground" : "border-transparent",
          )}
          style={{ backgroundColor: ACCENTS[id].swatch }}
        >
          {value === id ? <Check className="size-5 text-white drop-shadow" aria-hidden /> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Settings → Appearance → Colour theme: main colour for light and dark mode, and a light or dark
 * menu in light mode. "Only me" keeps it on this device; the owner can set it for every login.
 */
export function ColorThemeSection() {
  const { owner } = useAccess();
  const { effective, mine, gym, loading } = useColorTheme();
  const [draft, setDraft] = useState<ColorTheme>(effective);
  const [saving, setSaving] = useState(false);
  const key = JSON.stringify(effective);
  useEffect(() => {
    if (!loading) setDraft(effective);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loading]);
  // Live preview while choosing; put back what is in force when leaving the page unsaved.
  const inForce = useRef(effective);
  inForce.current = effective;
  useEffect(() => {
    applyColorTheme(draft);
  }, [draft]);
  useEffect(() => () => applyColorTheme(inForce.current), []);

  const setLight = (patch: Partial<ColorTheme["light"]>) =>
    setDraft((d) => ({ ...d, light: { ...d.light, ...patch } }));

  const saveForMe = () => {
    setLocalColorTheme(draft);
    toast.success("Colour theme saved for you on this device");
  };
  const saveForEveryone = async () => {
    setSaving(true);
    try {
      await saveGymColorTheme(draft);
      setLocalColorTheme(null); // the owner sees the gym's theme too
      toast.success("Colour theme saved for every login");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const useGym = () => {
    setLocalColorTheme(null);
    toast.success(gym ? "Using the gym's colour theme" : "Back to the default colours");
  };

  return (
    <FormSection
      title="Colour theme"
      description={
        mine
          ? "You are using your own colours on this device."
          : gym
            ? "You are using the gym's colours (set by the owner)."
            : "Default colours. Pick new ones below: they show straight away."
      }
      footer={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={saveForMe}>
            Only me (this device)
          </Button>
          {owner ? (
            <Button onClick={() => saveForEveryone()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null} Everyone (all
              logins)
            </Button>
          ) : null}
          {mine ? (
            <Button variant="ghost" onClick={useGym}>
              {gym ? "Use the gym's colours" : "Default colours"}
            </Button>
          ) : null}
          {owner && gym ? (
            <Button variant="ghost" onClick={() => setDraft(DEFAULT_COLOR_THEME)}>
              Start from default
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-2">
          <p className="text-label">Light mode colour</p>
          <Swatches
            label="Light mode colour"
            value={draft.light.accent}
            onChange={(accent) => setLight({ accent })}
          />
        </div>
        <div className="grid gap-2">
          <p className="text-label">Light mode menu</p>
          <div
            role="radiogroup"
            aria-label="Light mode menu"
            className="grid max-w-sm grid-cols-2 gap-2"
          >
            {(["light", "dark"] as MenuStyle[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={draft.light.menu === m}
                onClick={() => setLight({ menu: m })}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-xl border p-2 text-left text-sm font-semibold",
                  draft.light.menu === m
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-accent",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-8 w-5 shrink-0 rounded border",
                    m === "dark" ? "bg-[#1b1a18]" : "bg-white",
                  )}
                />
                {m === "light" ? "Light menu" : "Dark menu"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          <p className="text-label">Dark mode colour</p>
          <Swatches
            label="Dark mode colour"
            value={draft.dark.accent}
            onChange={(accent) => setDraft((d) => ({ ...d, dark: { accent } }))}
          />
        </div>
        <p className="text-meta">
          Light or dark itself is chosen above (Theme). “Only me” keeps these colours on this
          device;{" "}
          {owner
            ? "“Everyone” changes every staff login (anyone who picked their own keeps theirs)."
            : "only the owner can change them for everyone."}
        </p>
      </div>
    </FormSection>
  );
}
