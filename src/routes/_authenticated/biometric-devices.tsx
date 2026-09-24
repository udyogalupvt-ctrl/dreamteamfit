import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Copy, Fingerprint, MoreHorizontal, Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { DeviceFormDialog } from "@/components/biometrics/device-form-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingRows } from "@/components/common/loading-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLive } from "@/hooks/use-live-query";
import { firestoreErrorMessage } from "@/services/firestore.service";
import {
  deviceConnection,
  setDeviceStatus,
  subscribeDevices,
} from "@/services/biometric-devices.service";
import type { BiometricDevice } from "@/types/models";

export const Route = createFileRoute("/_authenticated/biometric-devices")({
  head: () => ({
    meta: [
      { title: "Fingerprint Devices — REBUILD FITNESS" },
      {
        name: "description",
        content: "Connect eSSL / ZKTeco fingerprint devices for thumb registration and attendance.",
      },
    ],
  }),
  component: DevicesPage,
});

/** The device talks to this app itself (/iclock on the same Vercel domain), port 443. */
const serverHost = () =>
  typeof window === "undefined" ? "your-app.vercel.app" : window.location.host;

function useTick(ms = 15000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function DevicesPage() {
  useTick();
  const live = useLive<BiometricDevice[]>(subscribeDevices, [], []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BiometricDevice | null>(null);
  const toggle = async (d: BiometricDevice) => {
    try {
      await setDeviceStatus(d.id, d.status === "disabled" ? "unknown" : "disabled");
      toast.success(d.status === "disabled" ? "Device enabled" : "Device disabled");
    } catch (e) {
      toast.error(firestoreErrorMessage(e));
    }
  };
  const add = () => {
    setEditing(null);
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fingerprint Devices"
        description="Connect the entrance device once. After that, thumbs are registered from the joining screen."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Fingerprint Devices" }]}
        actions={
          <Button onClick={add}>
            <Plus aria-hidden /> Add device
          </Button>
        }
      />
      {live.error ? (
        <ErrorState error={live.error} title="Couldn't load devices" />
      ) : live.loading ? (
        <LoadingRows rows={3} />
      ) : live.data.length === 0 ? (
        <EmptyState
          icon={Fingerprint}
          title="No device connected yet"
          description="Add your eSSL or ZKTeco device with its serial number, then enter the cloud settings below on the device."
          action={
            <Button onClick={add}>
              <Plus aria-hidden /> Add device
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {live.data.map((d) => {
            const c = deviceConnection(d);
            return (
              <li key={d.id} className="surface-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{d.name}</p>
                    <p className="text-meta">
                      {d.manufacturer}
                      {d.model ? ` ${d.model}` : ""}
                      {d.serialNumber ? ` · SN ${d.serialNumber}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusPill
                      tone={
                        c.online
                          ? "success"
                          : d.status === "disabled"
                            ? "danger"
                            : d.integrationType === "adms"
                              ? "warning"
                              : "info"
                      }
                    >
                      {c.label}
                    </StatusPill>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.name}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(d);
                            setOpen(true);
                          }}
                        >
                          <Pencil aria-hidden /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void toggle(d)}>
                          <Power aria-hidden /> {d.status === "disabled" ? "Enable" : "Disable"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <p className="text-meta mt-3">
                  {d.integrationType === "adms"
                    ? d.lastSeenAt
                      ? `Last contact ${formatDistanceToNow(d.lastSeenAt, { addSuffix: true })}${d.lastSyncAt ? ` · punches synced ${formatDistanceToNow(d.lastSyncAt, { addSuffix: true })}` : ""}`
                      : "Waiting for the device to connect. Enter the settings below on the device."
                    : d.integrationType === "mock"
                      ? "Test device — it can never activate a member."
                      : "Not linked to the cloud. Edit it and choose Cloud (ADMS) to register thumbs."}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <SetupGuide />
      <DeviceFormDialog open={open} onOpenChange={setOpen} device={editing} />
    </div>
  );
}

function SetupGuide() {
  const copy = (v: string) =>
    void navigator.clipboard.writeText(v).then(() => toast.success("Copied"));
  const rows: [string, string][] = [
    ["Server address", serverHost()],
    ["Server port", "443"],
    ["HTTPS / SSL", "ON"],
    ["Domain name", "ON (if asked)"],
    ["Proxy server", "OFF"],
  ];
  return (
    <section className="surface-card space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="text-card-title">One-time device setup</h2>
        <p className="text-meta">
          On the device: Menu → Comm. → Cloud Server Setting (also called ADMS / Webserver).
        </p>
      </div>
      <dl className="divide-y divide-border rounded-xl border border-border">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="flex items-center gap-2 font-mono font-semibold">
              <span className="break-all">{v}</span>
              {k === "Server address" ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Copy server address"
                  onClick={() => copy(v)}
                >
                  <Copy aria-hidden />
                </Button>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>
          Connect the device to the internet (LAN cable or Wi-Fi) and set its date & time correctly.
        </li>
        <li>Add the device here with its serial number.</li>
        <li>
          Enter the settings above on the device and restart it. It shows <b>Online</b> here within
          a minute.
        </li>
        <li>
          Register thumbs from the joining screen. The device beeps and asks the member to press 3
          times.
        </li>
      </ol>
      <p className="text-meta">
        Older devices without HTTPS can use the small relay in <code>tools/adms-relay.mjs</code> on
        the front-desk PC. See BIOMETRIC_SETUP.md.
      </p>
    </section>
  );
}
