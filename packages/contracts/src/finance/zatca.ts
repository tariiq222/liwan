import { z } from 'zod'

/** A ZATCA validation message: the rule code when ZATCA gave one, and its text. */
export const FinanceZatcaMessageSchema = z.object({
  code: z.string().nullable(),
  message: z.string(),
}).strict()

export const FinanceZatcaSubmissionStateSchema = z.enum([
  'not_applicable', 'pending', 'retry', 'rejected', 'blocked', 'unauthorized', 'accepted',
])

/**
 * Where one document stands with ZATCA. `retry`: no verdict yet (ZATCA unreachable, a 5xx, or
 * warnings only; the errors hold ZATCA's codes when it gave any); `rejected` carries ZATCA's
 * validation errors; `blocked` is a local failure before any verdict (signing, certificate,
 * chain-head block, unexpected answer); `unauthorized`: ZATCA refused the journal certificate,
 * onboard again; `accepted` may carry warnings. `clearance` is a standard (B2B) invoice,
 * `reporting` a simplified (B2C) one.
 */
export const FinanceZatcaSubmissionSchema = z.object({
  state: FinanceZatcaSubmissionStateSchema,
  mode: z.enum(['clearance', 'reporting']).nullable(),
  errors: z.array(FinanceZatcaMessageSchema),
  warnings: z.array(FinanceZatcaMessageSchema),
  qr_present: z.boolean(),
}).strict()

/** POST /finance/zatca/journals/{id}/onboard: the six-digit one-time password of the Fatoora portal. */
export const FinanceZatcaOnboardInputSchema = z.object({
  otp: z.string().regex(/^\d{6}$/),
}).strict()

export const FinanceZatcaErrorCodeSchema = z.enum([
  'zatca_unavailable', 'zatca_rejected', 'zatca_local_error', 'zatca_unauthorized', 'zatca_mode_not_allowed',
  'zatca_not_onboarded', 'zatca_not_applicable',
])

export type FinanceZatcaMessage = z.infer<typeof FinanceZatcaMessageSchema>
export type FinanceZatcaSubmission = z.infer<typeof FinanceZatcaSubmissionSchema>
export type FinanceZatcaOnboardInput = z.infer<typeof FinanceZatcaOnboardInputSchema>
