import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, MessageCircle } from "lucide-react";
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
import { CLOUDINARY_BRAND_FOLDER, GYM_NAME } from "@/constants/navigation";
import { CLOUDINARY_CLOUD_NAME } from "@/lib/cloudinary";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useLive } from "@/hooks/use-live-query";
import { DEFAULT_BILLING_SETTINGS, saveBusinessSettings, subscribeBusinessSettings } from "@/services/business-settings.service";
import { DEFAULT_AUTOMATION_SETTINGS } from "@/lib/automation-templates";
import { saveAutomationSettings, subscribeAutomationSettings } from "@/services/automation-settings.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { AutomationSettings, BusinessBillingSettings, WhatsAppSettings } from "@/types/models";
import { DEFAULT_WHATSAPP_SETTINGS,saveWhatsAppSettings,subscribeWhatsAppSettings } from "@/services/whatsapp-settings.service";
import { testWhatsAppConnection } from "@/services/whatsapp.service";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — REBUILD FITNESS" },
      { name: "description", content: "Gym profile, appearance and platform connections." },
      { property: "og:title", content: "Settings — REBUILD FITNESS" },
      { property: "og:description", content: "Gym profile, appearance and platform connections." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  const billingLive=useLive(subscribeBusinessSettings,DEFAULT_BILLING_SETTINGS,[]);
  const [billing,setBilling]=useState<BusinessBillingSettings>(DEFAULT_BILLING_SETTINGS);
  const automationLive=useLive(subscribeAutomationSettings,DEFAULT_AUTOMATION_SETTINGS,[]);
  const [automation,setAutomation]=useState<AutomationSettings>(DEFAULT_AUTOMATION_SETTINGS);
  const whatsappLive=useLive(subscribeWhatsAppSettings,DEFAULT_WHATSAPP_SETTINGS,[]);
  const [whatsapp,setWhatsapp]=useState<WhatsAppSettings>(DEFAULT_WHATSAPP_SETTINGS);
  const [testingWhatsapp,setTestingWhatsapp]=useState(false);
  useEffect(()=>setBilling(billingLive.data),[billingLive.data]);
  useEffect(()=>setAutomation(automationLive.data),[automationLive.data]);
  useEffect(()=>setWhatsapp(whatsappLive.data),[whatsappLive.data]);
  const update=<K extends keyof BusinessBillingSettings>(key:K,value:BusinessBillingSettings[K])=>setBilling(v=>({...v,[key]:value}));
  const saveBilling=async()=>{try{await saveBusinessSettings(billing);toast.success("Billing settings saved")}catch(e){toast.error(firestoreErrorMessage(e))}};
  const saveAutomation=async()=>{try{await saveAutomationSettings(automation);toast.success("Automation settings saved")}catch(e){toast.error(firestoreErrorMessage(e))}};
  const saveWhatsapp=async()=>{try{await saveWhatsAppSettings(whatsapp);toast.success("WhatsApp settings saved")}catch(e){toast.error(firestoreErrorMessage(e))}};
  const testWhatsapp=async()=>{setTestingWhatsapp(true);try{const result=await testWhatsAppConnection();result.configured?toast.success(result.detail):toast.warning(result.detail)}catch(e){toast.error(firestoreErrorMessage(e))}finally{setTestingWhatsapp(false)}};

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
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
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
            <ImageUpload label="Logo" folder={CLOUDINARY_BRAND_FOLDER} />
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
        <TabsContent value="billing"><FormSection title="Invoice & tax settings" description="Used on bills, PDFs, and secure public invoices." footer={<Button onClick={()=>void saveBilling()}>Save billing settings</Button>}><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-1.5"><Label htmlFor="business-name">Business name</Label><Input id="business-name" value={billing.businessName} onChange={e=>update("businessName",e.target.value)}/></div><div className="grid gap-1.5"><Label htmlFor="invoice-prefix">Invoice prefix</Label><Input id="invoice-prefix" value={billing.invoicePrefix} onChange={e=>update("invoicePrefix",e.target.value.toUpperCase())}/></div><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="business-address">Address</Label><Textarea id="business-address" value={billing.address} onChange={e=>update("address",e.target.value)}/></div><div className="grid gap-1.5"><Label htmlFor="business-phone">Phone</Label><Input id="business-phone" value={billing.phone} onChange={e=>update("phone",e.target.value)}/></div><div className="grid gap-1.5"><Label htmlFor="business-email">Email</Label><Input id="business-email" type="email" value={billing.email} onChange={e=>update("email",e.target.value)}/></div><div className="grid gap-1.5"><Label htmlFor="gstin">GSTIN</Label><Input id="gstin" value={billing.gstin} onChange={e=>update("gstin",e.target.value)}/></div><div className="grid gap-1.5"><Label htmlFor="currency-billing">Currency</Label><Input id="currency-billing" value="INR" disabled/></div><label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><Checkbox checked={billing.taxEnabled} onCheckedChange={v=>update("taxEnabled",v===true)}/> Enable tax on new invoices</label>{billing.taxEnabled?<div className="grid gap-1.5"><Label htmlFor="tax-rate">Tax rate (%)</Label><Input id="tax-rate" type="number" min="0" max="100" value={billing.taxRate} onChange={e=>update("taxRate",Number(e.target.value))}/></div>:null}</div></FormSection></TabsContent>
        <TabsContent value="automation"><FormSection title="Retention automation" description="Daily checks run in Asia/Kolkata. Messages currently use the mock provider." footer={<Button onClick={()=>void saveAutomation()}>Save automation settings</Button>}><div className="grid gap-4"><label className="flex items-center gap-2 text-sm font-semibold"><Checkbox checked={automation.automationEnabled} onCheckedChange={v=>setAutomation(x=>({...x,automationEnabled:v===true}))}/> Automation enabled</label><label className="flex items-center gap-2 text-sm font-semibold"><Checkbox checked={automation.renewalEnabled} onCheckedChange={v=>setAutomation(x=>({...x,renewalEnabled:v===true}))}/> Renewal reminders enabled</label><div className="grid gap-1.5"><Label htmlFor="renewal-days">Days before membership expiry</Label><Input id="renewal-days" type="number" min="1" max="30" value={automation.renewalDaysBefore} onChange={e=>setAutomation(x=>({...x,renewalDaysBefore:Number(e.target.value)}))}/></div><div className="grid gap-1.5"><Label htmlFor="renewal-template">Renewal message</Label><Textarea id="renewal-template" className="min-h-36" value={automation.renewalTemplate} onChange={e=>setAutomation(x=>({...x,renewalTemplate:e.target.value}))}/></div><label className="flex items-center gap-2 text-sm font-semibold"><Checkbox checked={automation.birthdayEnabled} onCheckedChange={v=>setAutomation(x=>({...x,birthdayEnabled:v===true}))}/> Birthday greetings enabled</label><div className="grid gap-1.5"><Label htmlFor="birthday-template">Birthday message</Label><Textarea id="birthday-template" className="min-h-32" value={automation.birthdayTemplate} onChange={e=>setAutomation(x=>({...x,birthdayTemplate:e.target.value}))}/></div><label className="flex items-center gap-2 text-sm font-semibold"><Checkbox checked={automation.followUpRemindersEnabled} onCheckedChange={v=>setAutomation(x=>({...x,followUpRemindersEnabled:v===true}))}/> Follow-up reminders enabled</label></div></FormSection></TabsContent>

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
        <TabsContent value="whatsapp"><FormSection title="WhatsApp Cloud API" description="Mock mode records safe test deliveries. Live mode uses credentials stored only in Firebase Functions." footer={<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={testingWhatsapp||whatsapp.mode!=="whatsapp"} onClick={()=>void testWhatsapp()}><MessageCircle/>{testingWhatsapp?"Testing…":"Test connection"}</Button><Button onClick={()=>void saveWhatsapp()}>Save WhatsApp settings</Button></div>}><div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><StatusRow label="WhatsApp delivery" ok={whatsapp.mode==="mock"} detail={whatsapp.mode==="mock"?"Mock mode is active. No message leaves the app.":"Live mode selected. Use Test connection to verify server credentials."}/></div><div className="grid gap-1.5"><Label htmlFor="wa-mode">Provider mode</Label><Select value={whatsapp.mode} onValueChange={value=>setWhatsapp(x=>({...x,mode:value as WhatsAppSettings["mode"],enabled:true}))}><SelectTrigger id="wa-mode"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="mock">Mock</SelectItem><SelectItem value="whatsapp">WhatsApp Cloud API</SelectItem></SelectContent></Select></div><div className="grid gap-1.5"><Label htmlFor="wa-country">Default country code</Label><Input id="wa-country" value={whatsapp.defaultCountryCode} onChange={e=>setWhatsapp(x=>({...x,defaultCountryCode:e.target.value.replace(/\D/g,"")}))}/></div><div className="grid gap-1.5"><Label htmlFor="wa-language">Template language</Label><Input id="wa-language" value={whatsapp.templateLanguage} onChange={e=>setWhatsapp(x=>({...x,templateLanguage:e.target.value}))}/></div><div className="grid gap-1.5"><Label htmlFor="wa-version">Graph API version</Label><Input id="wa-version" value={whatsapp.graphApiVersion} onChange={e=>setWhatsapp(x=>({...x,graphApiVersion:e.target.value}))}/></div>{[["invoiceTemplate","Invoice template"],["renewalTemplate","Renewal template"],["birthdayTemplate","Birthday template"],["followUpTemplate","Follow-up template"]].map(([key,label])=><div className="grid gap-1.5" key={key}><Label htmlFor={`wa-${key}`}>{label}</Label><Input id={`wa-${key}`} value={String(whatsapp[key as keyof WhatsAppSettings])} onChange={e=>setWhatsapp(x=>({...x,[String(key)]:e.target.value}))}/></div>)}</div><p className="text-meta">Access tokens, app secrets and webhook verification tokens are never stored or displayed here.</p></FormSection></TabsContent>
      </Tabs>
    </div>
  );
}
