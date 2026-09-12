import { z } from "zod";

/** ISO-8601 timestamp string. */
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

/** A money amount + its billing period. Kept simple for the demo. */
export const BillingPeriodSchema = z.enum([
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "policy_term",
  "one_time",
]);
export type BillingPeriod = z.infer<typeof BillingPeriodSchema>;

export const MoneySchema = z.object({
  amount: z.number(),
  currency: z.string().default("USD"),
});
export type Money = z.infer<typeof MoneySchema>;

/**
 * Canonical API error format shared by every route handler. (Checkpoint 1.)
 * Keep this stable — all four people parse it on the client.
 */
export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Optional field-level detail for form errors. */
    fields: z.record(z.string(), z.string()).optional(),
    /** Optional machine-readable context (never include private data). */
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Generic success envelope. Use `apiOk(data)` / `apiError(...)` helpers. */
export const ApiOkSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ ok: z.literal(true), data });

export function apiOk<T>(data: T) {
  return { ok: true as const, data };
}

export function apiError(
  code: string,
  message: string,
  extra?: { fields?: Record<string, string>; details?: Record<string, unknown> }
): ApiError {
  return { ok: false, error: { code, message, ...extra } };
}
