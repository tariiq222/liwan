import { z } from 'zod'
import { FinanceZatcaReadinessSchema } from './setup'
import { day, FinanceRefSchema, list } from './shared'

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

/**
 * The documents of the current company still waiting on ZATCA: `to_send` waits for the stock cron or a
 * manual submit, `retry` got no verdict (warnings, or ZATCA unreachable) and is retried by the cron, `rejected`
 * carries ZATCA's validation errors, `blocked` failed locally before any verdict; both need a correction.
 */
export const FinanceZatcaBacklogSchema = z.object({
  to_send: z.number().int().nonnegative(),
  retry: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
}).strict()

/** GET /finance/zatca/status: the onboarding readiness and the submission backlog. */
export const FinanceZatcaStatusSchema = FinanceZatcaReadinessSchema.extend({
  backlog: FinanceZatcaBacklogSchema,
}).strict()

/** POST /finance/zatca/journals/{id}/onboard: the six-digit one-time password of the Fatoora portal. */
export const FinanceZatcaOnboardInputSchema = z.object({
  otp: z.string().regex(/^\d{6}$/),
}).strict()

/**
 * GET /finance/zatca/documents[?state=]: the work list of e-invoices ZATCA has not accepted, oldest first. `state` filters on
 * pending, retry, rejected, blocked or unauthorized (the states of a submission that are not final).
 */
export const FinanceZatcaWaitingDocumentSchema = z.object({
  invoice: FinanceRefSchema,
  partner: FinanceRefSchema.nullable(),
  date: day.nullable(),
  amount_total: z.number(),
  move_type: z.string(),
  submission: FinanceZatcaSubmissionSchema,
}).strict()
export const FinanceZatcaWaitingDocumentListSchema = list(FinanceZatcaWaitingDocumentSchema)

export const FinanceZatcaErrorCodeSchema = z.enum([
  'zatca_unavailable', 'zatca_rejected', 'zatca_local_error', 'zatca_unauthorized', 'zatca_mode_not_allowed',
  'zatca_not_onboarded', 'zatca_not_applicable', 'company_profile_incomplete',
])

export type FinanceZatcaMessage = z.infer<typeof FinanceZatcaMessageSchema>
export type FinanceZatcaBacklog = z.infer<typeof FinanceZatcaBacklogSchema>
export type FinanceZatcaStatus = z.infer<typeof FinanceZatcaStatusSchema>
export type FinanceZatcaWaitingDocument = z.infer<typeof FinanceZatcaWaitingDocumentSchema>
export type FinanceZatcaSubmission = z.infer<typeof FinanceZatcaSubmissionSchema>
export type FinanceZatcaOnboardInput = z.infer<typeof FinanceZatcaOnboardInputSchema>
