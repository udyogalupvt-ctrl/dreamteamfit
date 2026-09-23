import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { FormSection } from "@/components/common/form-section";
import { ImageUpload } from "@/components/common/image-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { GYM_NAME } from "@/constants/navigation";
import { CLOUDINARY_CLOUD_NAME } from "@/lib/cloudinary";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — FORGE" },
      { name: "description", content: "Gym profile, appearance and platform connections." },
      { property: "og:title", content: "Settings — FORGE" },
      { property: "og:description", content: "Gym profile, appearance and platform connections." },
    ],
  }),
  component: SettingsPage,
});

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-meta break-words">{detail}</p>
      </div>
      <span
        className={cn(
          "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
          ok ? "bg-success/15 text-success" : "bg-warning/20 text-warning",
        )}
      >
        {ok ? "Connected" : "Action needed"}
      </span>
    </div>
  );
}

function SettingsPage() {
  const { configured: isFirebaseConfigured } = useAuth();
  const [gymName, setGymName] = useState(GYM_NAME);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Gym identity, appearance and platform connections."
        breadcrumbs={[{ label: "Home", to: "/dashboard" }, { label: "Settings" }]}
        actions={<Button onClick={() => toast.success("Preferences saved")}>Save changes</Button>}
      />

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <FormSection
            title="Gym profile"
            description="Shown across invoices, receipts and member communication."
            footer={
              <Button variant="outline" onClick={() => toast.success("Profile saved")}>
                Save profile
              </Button>
            }
          >
            <div className="grid gap-1.5">
              <Label htmlFor="gym-name">Gym name</Label>
              <Input
                id="gym-name"
                value={gymName}
                onChange={(event) => setGymName(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="contact">Contact number</Label>
                <Input id="contact" type="tel" placeholder="+91 98765 43210" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Select defaultValue="inr">
                  <SelectTrigger id="currency">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inr">INR — Indian Rupee</SelectItem>
                    <SelectItem value="usd">USD — US Dollar</SelectItem>
                    <SelectItem value="aed">AED — UAE Dirham</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Gym logo"
            description="Uploads go to Cloudinary and are reused for member photos later."
          >
            <ImageUpload label="Logo" folder="forge/branding" />
          </FormSection>
        </TabsContent>

        <TabsContent value="appearance">
          <FormSection
            title="Theme"
            description="Choose light, dark or follow your device. Saved on this device."
          >
            <ThemeToggle />
            <p className="text-sm text-muted-foreground">
              Dark mode uses deep graphite surfaces with energetic accents for long front-desk
              shifts.
            </p>
          </FormSection>
        </TabsContent>

        <TabsContent value="connections">
          <FormSection
            title="Platform connections"
            description="Backend services powering the workspace."
          >
            <StatusRow
              label="Firebase Authentication & Firestore"
              ok={isFirebaseConfigured}
              detail={
                isFirebaseConfigured
                  ? "Project leadsmanage-1f7cd is initialized."
                  : "Missing VITE_FIREBASE_API_KEY — add the Firebase web API key to enable sign-in."
              }
            />
            <StatusRow
              label="Cloudinary uploads"
              ok
              detail={`Cloud ${CLOUDINARY_CLOUD_NAME} · unsigned preset levelupingup`}
            />
          </FormSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
