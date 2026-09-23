import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormDialog } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deviceSchema } from "@/lib/biometric-validation";
import { saveDevice, type DeviceInput } from "@/services/biometric-devices.service";
import { firestoreErrorMessage } from "@/services/firestore.service";
import type { BiometricDevice } from "@/types/models";

const EMPTY: DeviceInput = {
  name: "Main entrance",
  manufacturer: "eSSL",
  model: "",
  serialNumber: "",
  deviceType: "Biometric terminal",
  location: "",
  connectionType: "Cloud",
  ipAddress: "",
  port: null,
  status: "unknown",
  integrationType: "adms",
};

export function DeviceFormDialog({
  open,
  onOpenChange,
  device,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  device?: BiometricDevice | null;
}) {
  const [form, setForm] = useState<DeviceInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setForm(
      device
        ? {
            name: device.name,
            manufacturer: device.manufacturer,
            model: device.model,
            serialNumber: device.serialNumber,
            deviceType: device.deviceType,
            location: device.location,
            connectionType: device.connectionType,
            ipAddress: device.ipAddress,
            port: device.port,
            status: device.status === "disabled" ? "disabled" : "unknown",
            integrationType: device.integrationType,
          }
        : EMPTY,
    );
    setError("");
  }, [open, device]);
  const set = <K extends keyof DeviceInput>(k: K, v: DeviceInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const cloud = form.integrationType === "adms";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = deviceSchema.safeParse(form);
    if (!parsed.success)
      return setError(parsed.error.issues[0]?.message ?? "Check the device details");
    if (cloud && parsed.data.serialNumber.trim().length < 5)
      return setError("Enter the device serial number (Menu → System info → Device info).");
    setSaving(true);
    try {
      await saveDevice(parsed.data, device?.id);
      toast.success(device ? "Device updated" : "Device added", {
        description: cloud ? "Now enter the cloud server settings on the device." : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(firestoreErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={device ? "Edit device" : "Add fingerprint device"}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="device-form" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}Save device
          </Button>
        </>
      }
    >
      <form id="device-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="How is it connected?" htmlFor="d-integration" className="sm:col-span-2">
          <Select
            value={form.integrationType}
            onValueChange={(v) => set("integrationType", v as DeviceInput["integrationType"])}
          >
            <SelectTrigger id="d-integration" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="adms">Cloud (eSSL / ZKTeco ADMS) — recommended</SelectItem>
              <SelectItem value="manual">Not connected (attendance entered by hand)</SelectItem>
              <SelectItem value="mock">
                Test device (practice only, never activates members)
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Name" htmlFor="d-name" required>
          <Input
            id="d-name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Main entrance"
          />
        </Field>
        <Field label="Brand" htmlFor="d-maker">
          <Select
            value={form.manufacturer}
            onValueChange={(v) => set("manufacturer", v as DeviceInput["manufacturer"])}
          >
            <SelectTrigger id="d-maker" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["eSSL", "ZKTeco", "Other"] as const).map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {cloud ? (
          <Field
            label="Serial number"
            htmlFor="d-serial"
            required
            hint="On the device: Menu → System info → Device info"
            className="sm:col-span-2"
          >
            <Input
              id="d-serial"
              value={form.serialNumber}
              autoCapitalize="characters"
              onChange={(e) => set("serialNumber", e.target.value.toUpperCase())}
              placeholder="e.g. CQZ7234560123"
            />
          </Field>
        ) : null}
        <Field label="Model (optional)" htmlFor="d-model">
          <Input
            id="d-model"
            value={form.model}
            onChange={(e) => set("model", e.target.value)}
            placeholder="e.g. X990, K30 Pro"
          />
        </Field>
        <Field label="Location (optional)" htmlFor="d-location">
          <Input
            id="d-location"
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </FormDialog>
  );
}
