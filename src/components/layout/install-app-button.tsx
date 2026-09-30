import { useEffect, useState } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import { FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import {
  installState,
  NOT_READY,
  promptInstall,
  subscribeInstall,
  type InstallState,
} from "@/lib/pwa";

/** Whether "Install app" can be offered here (hidden once installed or when running installed). */
export function useInstallApp() {
  const [state, setState] = useState<InstallState>(NOT_READY);
  useEffect(() => {
    setState(installState());
    return subscribeInstall(() => setState(installState()));
  }, []);
  return { ...state, available: !state.installed && (state.canPrompt || state.ios) };
}

/**
 * "Install app": the browser's own install dialog (Chrome / Edge, phone and computer), or the
 * iPhone steps. Shows only until the app is installed.
 */
export function InstallAppButton({ size = "sm" }: { size?: "sm" | "default" }) {
  const app = useInstallApp();
  const [iosHelp, setIosHelp] = useState(false);
  if (!app.available) return null;

  const install = async () => {
    if (app.canPrompt) {
      if (await promptInstall()) toast.success("Installed. Open REBUILD FITNESS from your apps.");
      return;
    }
    setIosHelp(true);
  };

  return (
    <>
      <Button size={size} variant="outline" onClick={() => void install()} aria-label="Install app">
        <Download aria-hidden />
        {size === "sm" ? (
          <>
            <span className="sm:hidden">Install</span>
            <span className="hidden sm:inline">Install app</span>
          </>
        ) : (
          "Install app"
        )}
      </Button>
      <FormDialog
        open={iosHelp}
        onOpenChange={setIosHelp}
        title="Install on iPhone / iPad"
        description="Apple adds apps from Safari's Share menu."
        footer={<Button onClick={() => setIosHelp(false)}>Done</Button>}
      >
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <b>1.</b> Open this page in <b>Safari</b>.
          </li>
          <li className="flex items-center gap-3">
            <b>2.</b> Tap <Share className="size-4" aria-label="Share" /> <b>Share</b> at the
            bottom.
          </li>
          <li className="flex items-center gap-3">
            <b>3.</b> Tap <SquarePlus className="size-4" aria-hidden /> <b>Add to Home Screen</b>,
            then <b>Add</b>.
          </li>
        </ol>
      </FormDialog>
    </>
  );
}
