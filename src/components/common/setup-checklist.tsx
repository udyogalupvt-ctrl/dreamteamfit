import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useLive } from "@/hooks/use-live-query";
import { cn } from "@/lib/utils";
import { subscribeDevices } from "@/services/biometric-devices.service";
import {
  DEFAULT_BILLING_SETTINGS,
  subscribeBusinessSettings,
} from "@/services/business-settings.service";
import { subscribeClients } from "@/services/clients.service";
import { subscribePackages } from "@/services/packages.service";
import { subscribeTrainers } from "@/services/pt.service";
import { subscribeStaff } from "@/services/staff.service";
import {
  DEFAULT_WHATSAPP_SETTINGS,
  subscribeWhatsAppSettings,
} from "@/services/whatsapp-settings.service";

const HIDE_KEY = "rf.setup-checklist.hidden";
const readHidden = () => {
  try {
    return window.localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * First steps for a new gym, in the order they are needed, each with a tick when done and a
 * button to the right page. Owners only; disappears when everything is done (or hidden).
 */
export function SetupChecklist() {
  const business = useLive(subscribeBusinessSettings, DEFAULT_BILLING_SETTINGS, []);
  const packages = useLive(subscribePackages, [], []);
  const trainers = useLive(subscribeTrainers, [], []);
  const staff = useLive(subscribeStaff, [], []);
  const wa = useLive(subscribeWhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, []);
  const devices = useLive(subscribeDevices, [], []);
  const clients = useLive(subscribeClients, [], []);
  const [hidden, setHidden] = useState(readHidden);

  const loading = [business, packages, trainers, staff, wa, devices, clients].some(
    (x) => x.loading,
  );
  const steps = [
    {
      done: !!(business.data.phone && business.data.address),
      title: "Gym details and logo",
      detail: "Name, phone and address print on every bill.",
      to: "/settings",
    },
    {
      done: packages.data.some((p) => p.isActive),
      title: "Gym packages",
      detail: "Monthly, quarterly… with their prices. Members can't join without one.",
      to: "/packages",
    },
    {
      done: trainers.data.length > 0,
      title: "Trainers (for PT)",
      detail: "Only if you sell personal training: each trainer's share.",
      to: "/packages",
    },
    {
      done: staff.data.some((s) => s.loginUid),
      title: "Receptionist login",
      detail: "Add staff, then give the front desk a login with only what they need.",
      to: "/staff",
    },
    {
      done: wa.data.mode === "whatsapp",
      title: "WhatsApp bills",
      detail: "Bills and reminders go out by themselves after payment.",
      to: "/settings",
    },
    {
      done: devices.data.length > 0,
      title: "Fingerprint machine",
      detail: "Connect it once; thumbs are then registered while joining.",
      to: "/biometric-devices",
    },
    {
      done: clients.data.length > 0,
      title: "First member",
      detail: "Press New member: details, package, payment, bill, thumb in one go.",
      to: "/clients",
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (loading || hidden || done === steps.length) return null;

  const hide = () => {
    try {
      window.localStorage.setItem(HIDE_KEY, "1");
    } catch {
      /* private mode: hide for this visit only */
    }
    setHidden(true);
  };

  return (
    <section className="surface-card space-y-4 p-4 sm:p-5" aria-labelledby="setup-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="setup-title" className="text-section-title">
            Get your gym ready
          </h2>
          <p className="text-meta">
            {done} of {steps.length} done. Do them in this order.
          </p>
        </div>
        <Button size="icon" variant="ghost" onClick={hide} aria-label="Hide this list">
          <X aria-hidden />
        </Button>
      </div>
      <Progress value={(done / steps.length) * 100} aria-label="Setup progress" />
      <ol className="divide-y divide-border">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-center gap-3 py-3">
            {s.done ? (
              <CheckCircle2 className="size-5 shrink-0 text-success" aria-label="Done" />
            ) : (
              <Circle className="size-5 shrink-0 text-muted-foreground" aria-label="Not done" />
            )}
            <div className="min-w-0 flex-1">
              <p className={cn("font-semibold", s.done && "text-muted-foreground line-through")}>
                {i + 1}. {s.title}
              </p>
              {!s.done ? <p className="text-meta">{s.detail}</p> : null}
            </div>
            {!s.done ? (
              <Button size="sm" variant="outline" asChild>
                <Link to={s.to}>Set up</Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
