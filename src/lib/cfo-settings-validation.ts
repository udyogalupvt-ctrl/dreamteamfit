import { z } from "zod";
import {
  CFO_LANGUAGES,
  DEFAULT_CFO_SETTINGS,
  type CfoLanguage,
  type CfoSettings,
} from "@/lib/cfo/types";

/** The CFO settings as typed on the form (numbers stay text until they are checked). */
export interface CfoSettingsForm {
  openingBalance: string;
  openingDate: string;
  atRiskDays: string;
  renewalDays: string;
  newMemberMinVisits: string;
  ptMinVisits: string;
  runwayWarnMonths: string;
  graceDays: string;
  aiEnabled: boolean;
  language: CfoLanguage;
}

export type CfoSettingsErrors = Partial<Record<keyof CfoSettingsForm, string>>;

export function cfoSettingsToForm(s: CfoSettings): CfoSettingsForm {
  return {
    openingBalance: s.openingBalance === null ? "" : String(s.openingBalance),
    openingDate: s.openingDate,
    atRiskDays: String(s.atRiskDays),
    renewalDays: String(s.renewalDays),
    newMemberMinVisits: String(s.newMemberMinVisits),
    ptMinVisits: String(s.ptMinVisits),
    runwayWarnMonths: String(s.runwayWarnMonths),
    graceDays: String(s.graceDays),
    aiEnabled: s.aiEnabled,
    language: s.language,
  };
}

const num = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label}: enter a number`)
    .transform((v) => Number(v))
    .pipe(z.number({ invalid_type_error: `${label}: enter a number` }).finite());

const whole = (label: string, min: number, max: number) =>
  num(label).pipe(
    z
      .number()
      .int(`${label}: use a whole number`)
      .min(min, `${label}: at least ${min}`)
      .max(max, `${label}: at most ${max}`),
  );

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Checks the form. `today` ("YYYY-MM-DD") is the latest allowed opening date. */
export function validateCfoSettings(
  form: CfoSettingsForm,
  today: string,
): { ok: true; value: CfoSettings } | { ok: false; errors: CfoSettingsErrors } {
  const schema = z
    .object({
      openingBalance: z
        .string()
        .trim()
        .transform((v) => (v === "" ? null : Number(v)))
        .pipe(
          z
            .number({ invalid_type_error: "Enter an amount in rupees" })
            .finite()
            .min(0, "Money in the gym can't be less than 0")
            .max(1_000_000_000, "That amount is too large")
            .nullable(),
        ),
      openingDate: z
        .string()
        .trim()
        .refine((v) => v === "" || isoDate.test(v), "Choose a valid date")
        .refine((v) => v === "" || v <= today, "The date can't be in the future"),
      atRiskDays: whole("Days not seen", 1, 120),
      renewalDays: whole("Renewal window", 1, 120),
      newMemberMinVisits: whole("Visits for new members", 1, 30),
      ptMinVisits: whole("Visits for PT chances", 1, 30),
      runwayWarnMonths: num("Warn below").pipe(
        z.number().min(0.5, "Warn below: at least 0.5").max(24, "Warn below: at most 24"),
      ),
      graceDays: whole("Grace days", 0, 90),
      aiEnabled: z.boolean(),
      language: z.enum(CFO_LANGUAGES),
    })
    .superRefine((v, ctx) => {
      if (v.openingBalance !== null && !v.openingDate)
        ctx.addIssue({
          code: "custom",
          path: ["openingDate"],
          message: "Choose the date this money was counted",
        });
      if (v.openingBalance === null && v.openingDate)
        ctx.addIssue({
          code: "custom",
          path: ["openingBalance"],
          message: "Enter the money you had on that date",
        });
    });

  const parsed = schema.safeParse(form);
  if (!parsed.success) {
    const errors: CfoSettingsErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof CfoSettingsForm | undefined;
      if (key && !errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }
  const v = parsed.data;
  return {
    ok: true,
    value: {
      ...DEFAULT_CFO_SETTINGS,
      ...v,
      openingBalance: v.openingBalance === null ? null : Math.round(v.openingBalance * 100) / 100,
    },
  };
}
