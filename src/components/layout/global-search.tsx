import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarCheck,
  CalendarClock,
  Cpu,
  Dumbbell,
  MessageSquareHeart,
  Package,
  ReceiptIndianRupee,
  Salad,
  Search,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useLive } from "@/hooks/use-live-query";
import { normalizePhone } from "@/lib/format";
import { subscribeClients } from "@/services/clients.service";
import { subscribeInquiries } from "@/services/inquiries.service";
import { subscribePackages } from "@/services/packages.service";
import { subscribeWorkoutPlans } from "@/services/workout-plans.service";
import { subscribeDietPlans } from "@/services/diet-plans.service";
import { subscribeBookings } from "@/services/bookings.service";
import { subscribeGroupClasses } from "@/services/group-classes.service";
import { subscribeExpenses } from "@/services/expenses.service";
import { useAccess } from "@/hooks/use-access";
import { subscribeInvoices } from "@/services/invoices.service";
import { subscribeAttendance } from "@/services/attendance.service";
import { subscribeDevices } from "@/services/biometric-devices.service";
import { subscribeFollowUps } from "@/services/followups.service";
import type {
  AttendanceEvent,
  BiometricDevice,
  Booking,
  Client,
  DietPlan,
  Expense,
  FollowUp,
  GroupClass,
  Invoice,
  GymPackage,
  Inquiry,
  WorkoutPlan,
} from "@/types/models";

export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const clients = useLive<Client[]>(subscribeClients, [], []);
  const inquiries = useLive<Inquiry[]>(subscribeInquiries, [], []);
  const packages = useLive<GymPackage[]>(subscribePackages, [], []);
  const workoutPlans = useLive<WorkoutPlan[]>(subscribeWorkoutPlans, [], []);
  const dietPlans = useLive<DietPlan[]>(subscribeDietPlans, [], []);
  const bookings = useLive<Booking[]>(subscribeBookings, [], []);
  const classes = useLive<GroupClass[]>(subscribeGroupClasses, [], []);
  const finance = useAccess().can("finance");
  const expenses = useLive<Expense[]>(finance ? subscribeExpenses : null, [], [finance]);
  const invoices = useLive<Invoice[]>(subscribeInvoices, [], []);
  const attendance = useLive<AttendanceEvent[]>(subscribeAttendance, [], []);
  const devices = useLive<BiometricDevice[]>(subscribeDevices, [], []);
  const followUps = useLive<FollowUp[]>(subscribeFollowUps, [], []);
  const q = query.trim().toLowerCase();
  const phone = normalizePhone(query);

  const results = useMemo(
    () => ({
      clients: q
        ? clients.data
            .filter(
              (item) =>
                item.fullName.toLowerCase().includes(q) ||
                item.clientCode.toLowerCase().includes(q) ||
                (phone.length >= 3 && item.phoneNormalized.includes(phone)),
            )
            .slice(0, 5)
        : [],
      inquiries: q
        ? inquiries.data
            .filter(
              (item) =>
                item.name.toLowerCase().includes(q) ||
                (phone.length >= 3 && item.phoneNormalized.includes(phone)),
            )
            .slice(0, 5)
        : [],
      packages: q
        ? packages.data
            .filter(
              (item) =>
                item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
            )
            .slice(0, 5)
        : [],
      workoutPlans: q
        ? workoutPlans.data
            .filter(
              (item) => item.name.toLowerCase().includes(q) || item.goal.toLowerCase().includes(q),
            )
            .slice(0, 5)
        : [],
      dietPlans: q
        ? dietPlans.data
            .filter(
              (item) => item.name.toLowerCase().includes(q) || item.goal.toLowerCase().includes(q),
            )
            .slice(0, 5)
        : [],
      bookings: q
        ? bookings.data
            .filter(
              (item) =>
                item.clientNameSnapshot.toLowerCase().includes(q) ||
                item.trainerNameSnapshot.toLowerCase().includes(q),
            )
            .slice(0, 5)
        : [],
      classes: q
        ? classes.data
            .filter(
              (item) =>
                item.name.toLowerCase().includes(q) ||
                item.trainerNameSnapshot.toLowerCase().includes(q),
            )
            .slice(0, 5)
        : [],
      invoices: q
        ? invoices.data
            .filter(
              (item) =>
                item.invoiceNumber.toLowerCase().includes(q) ||
                item.clientNameSnapshot.toLowerCase().includes(q) ||
                item.clientPhoneSnapshot.includes(phone),
            )
            .slice(0, 5)
        : [],
      expenses: q
        ? expenses.data
            .filter(
              (item) =>
                item.title.toLowerCase().includes(q) ||
                item.category.toLowerCase().includes(q) ||
                item.notes.toLowerCase().includes(q),
            )
            .slice(0, 5)
        : [],
      attendance: q
        ? attendance.data
            .filter(
              (item) =>
                item.clientNameSnapshot.toLowerCase().includes(q) ||
                item.biometricUserId.toLowerCase().includes(q),
            )
            .slice(0, 5)
        : [],
      devices: q
        ? devices.data
            .filter(
              (item) =>
                item.name.toLowerCase().includes(q) ||
                item.location.toLowerCase().includes(q) ||
                item.manufacturer.toLowerCase().includes(q),
            )
            .slice(0, 5)
        : [],
      followUps: q
        ? followUps.data
            .filter(
              (item) =>
                item.clientNameSnapshot.toLowerCase().includes(q) ||
                item.reason.toLowerCase().includes(q) ||
                (phone.length >= 3 && normalizePhone(item.phoneSnapshot).includes(phone)),
            )
            .slice(0, 5)
        : [],
    }),
    [
      clients.data,
      inquiries.data,
      packages.data,
      workoutPlans.data,
      dietPlans.data,
      bookings.data,
      classes.data,
      expenses.data,
      invoices.data,
      attendance.data,
      devices.data,
      followUps.data,
      phone,
      q,
    ],
  );

  const go = (
    to:
      | "/clients/$clientId"
      | "/leads"
      | "/packages"
      | "/workout-plans"
      | "/diet-plans"
      | "/bookings"
      | "/group-classes"
      | "/expenses"
      | "/billing"
      | "/attendance"
      | "/biometric-devices",
    clientId?: string,
  ) => {
    setOpen(false);
    setQuery("");
    if (to === "/clients/$clientId" && clientId) {
      void navigate({ to, params: { clientId } });
    } else {
      void navigate({ to });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "grid size-10 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            : "flex h-10 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:border-ring"
        }
        aria-label="Search members, inquiries and packages"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        {!compact ? <span>Search members, inquiries and packages…</span> : null}
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search real gym records…"
        />
        <CommandList>
          <CommandEmpty>
            {q ? "No matching records found." : "Start typing to search."}
          </CommandEmpty>
          {results.clients.length ? (
            <CommandGroup heading="Members">
              {results.clients.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`client ${item.fullName} ${item.clientCode}`}
                  onSelect={() => go("/clients/$clientId", item.id)}
                >
                  <Users aria-hidden />
                  <span className="min-w-0 truncate">{item.fullName}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{item.clientCode}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.inquiries.length ? (
            <CommandGroup heading="Inquiries">
              {results.inquiries.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`inquiry ${item.name} ${item.phone}`}
                  onSelect={() => go("/leads")}
                >
                  <UserPlus aria-hidden />
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{item.phone}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.packages.length ? (
            <CommandGroup heading="Packages">
              {results.packages.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`package ${item.name}`}
                  onSelect={() => go("/packages")}
                >
                  <Package aria-hidden />
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.durationDays} days
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.workoutPlans.length ? (
            <CommandGroup heading="Workout Plans">
              {results.workoutPlans.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`workout ${item.name} ${item.goal}`}
                  onSelect={() => go("/workout-plans")}
                >
                  <Dumbbell aria-hidden />
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{item.goal}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.dietPlans.length ? (
            <CommandGroup heading="Diet Plans">
              {results.dietPlans.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`diet ${item.name} ${item.goal}`}
                  onSelect={() => go("/diet-plans")}
                >
                  <Salad aria-hidden />
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{item.goal}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.bookings.length ? (
            <CommandGroup heading="Bookings">
              {results.bookings.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`booking ${item.clientNameSnapshot} ${item.trainerNameSnapshot}`}
                  onSelect={() => go("/bookings")}
                >
                  <CalendarClock aria-hidden />
                  <span className="min-w-0 truncate">
                    {item.clientNameSnapshot || "Group class booking"}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{item.date}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.classes.length ? (
            <CommandGroup heading="Group Classes">
              {results.classes.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`class ${item.name} ${item.trainerNameSnapshot}`}
                  onSelect={() => go("/group-classes")}
                >
                  <UsersRound aria-hidden />
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{item.date}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.invoices.length ? (
            <CommandGroup heading="Invoices">
              {results.invoices.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`invoice ${item.invoiceNumber} ${item.clientNameSnapshot}`}
                  onSelect={() => go("/billing")}
                >
                  <ReceiptIndianRupee aria-hidden />
                  <span className="min-w-0 truncate">
                    {item.invoiceNumber} · {item.clientNameSnapshot}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.paymentStatus}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.expenses.length ? (
            <CommandGroup heading="Expenses">
              {results.expenses.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`expense ${item.title} ${item.category}`}
                  onSelect={() => go("/expenses")}
                >
                  <ReceiptIndianRupee aria-hidden />
                  <span className="min-w-0 truncate">{item.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{item.category}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.attendance.length ? (
            <CommandGroup heading="Attendance">
              {results.attendance.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`attendance ${item.clientNameSnapshot} ${item.biometricUserId}`}
                  onSelect={() => go("/attendance")}
                >
                  <CalendarCheck aria-hidden />
                  <span className="min-w-0 truncate">{item.clientNameSnapshot}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.attendanceDate}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.devices.length ? (
            <CommandGroup heading="Biometric Devices">
              {results.devices.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`device ${item.name} ${item.location}`}
                  onSelect={() => go("/biometric-devices")}
                >
                  <Cpu aria-hidden />
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{item.status}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.followUps.length ? (
            <CommandGroup heading="Follow-ups">
              {results.followUps.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`follow-up ${item.clientNameSnapshot} ${item.reason}`}
                  onSelect={() => go("/leads")}
                >
                  <MessageSquareHeart aria-hidden />
                  <span className="min-w-0 truncate">
                    {item.clientNameSnapshot} · {item.reason}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{item.followUpDate}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
