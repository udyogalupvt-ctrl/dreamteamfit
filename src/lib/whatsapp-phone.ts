export type NormalizedWhatsAppPhone = { ok: true; value: string } | { ok: false; error: string };

export function normalizeWhatsAppPhone(input: string, defaultCountryCode = "91"): NormalizedWhatsAppPhone {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "WhatsApp number is required." };
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return { ok: false, error: "Enter a valid WhatsApp number." };
  if (!hasPlus && digits.length === 10) digits = `${defaultCountryCode.replace(/\D/g, "")}${digits}`;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 15) return { ok: false, error: "Use a valid international WhatsApp number." };
  return { ok: true, value: digits };
}