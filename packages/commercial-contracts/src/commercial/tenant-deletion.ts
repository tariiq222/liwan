import { z } from 'zod'

/**
 * The customer's own request to delete its workspace: asked, confirmed with an emailed code (the withdrawal window runs), `due` (the window
 * ended and the final hold runs: the workspace still works and the request can still be withdrawn), `deleting` (access is stopped and the
 * deletion is carried out; the vendor alone can still withdraw until the point of no return), `deleted` (final) or withdrawn.
 */
export const tenantDeletionStateSchema = z.enum(['requested', 'confirmed', 'due', 'deleting', 'deleted', 'withdrawn'])
/** The final hold after the window: the workspace still works and the request can still be withdrawn. Owner decision 2026-11-14. */
export const TENANT_DELETION_HOLD_HOURS = 72
/** The "last call" notice goes this long before the hold ends. */
export const TENANT_DELETION_LAST_CALL_HOURS = 24
/** The steps of the deletion in order (`reinstate` undoes the access stop of a request withdrawn before the point of no return). */
export const tenantDeletionStepNames = ['preflight', 'stop_access', 'commit', 'unbind_relay', 'drop_database', 'delete_cards', 'remove_filestore', 'remove_restore_copies',
  'purge_local_backups', 'purge_offsite', 'remove_side_files', 'clean_registry_rows', 'finish', 'anonymise_contacts', 'reinstate'] as const
export const tenantDeletionStepSchema = z.enum(tenantDeletionStepNames)
/** The days between the confirmation and the day the deletion falls due: the window in which the request can be withdrawn. Owner decision 2026-11-13: 90, because a customer may come back at any time. Nobody can shorten it. */
export const TENANT_DELETION_WINDOW_DAYS = 90
export const tenantDeletionCodeSchema = z.string().regex(/^\d{6}$/)

/** What the tenant sees: the state and its dates. `code_expires_at` is set only while the emailed code can still be used. */
export const tenantDeletionSchema = z.strictObject({
  state: z.enum(['requested', 'confirmed', 'due', 'deleting']),
  requested_at: z.string(),
  code_expires_at: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  due_at: z.string().nullable(),
  /** When the final hold ends (set from `due`); the request can be withdrawn by the customer until then. */
  hold_until: z.string().nullable().default(null),
  /** False once access is stopped (`deleting`): only the vendor can still withdraw, and only until the point of no return. */
  can_withdraw: z.boolean().default(true),
})
/** The vendor sees every request, withdrawn ones included, with what happened to the renewal. */
export const tenantDeletionRequestSchema = z.strictObject({
  id: z.uuid(), customer_id: z.uuid(), state: tenantDeletionStateSchema,
  requested_at: z.string(), requested_by: z.string(),
  confirmed_at: z.string().nullable(), due_at: z.string().nullable(), due_marked_at: z.string().nullable(),
  withdrawn_at: z.string().nullable(), withdrawn_by: z.enum(['customer', 'vendor']).nullable(), withdraw_reason: z.string().nullable(),
  renewal_outcome: z.enum(['cancelled', 'already_cancelled', 'not_cancellable']).nullable(),
  renewal_refusal: z.string().nullable(),
  hold_until: z.string().nullable(), deleting_at: z.string().nullable(), committed_at: z.string().nullable(), deleted_at: z.string().nullable(),
  /** `<step>:<code>` while the deletion is stuck or deferred and needs the vendor; null otherwise. Never a secret. */
  stuck_at: z.string().nullable(), stuck_code: z.string().nullable(),
})
/** One row of the step ledger: what ran, how often, and what it observed (names and counts only). */
export const tenantDeletionStepRowSchema = z.strictObject({
  step: tenantDeletionStepSchema, state: z.enum(['pending', 'running', 'done', 'failed', 'skipped']), intent: z.string().nullable(),
  attempts: z.number().int().min(0), failures: z.number().int().min(0), started_at: z.string().nullable(), finished_at: z.string().nullable(),
  next_attempt_at: z.string().nullable(), error_code: z.string().nullable(), evidence: z.record(z.string(), z.unknown()),
})
/** What the vendor sees of the run: the frozen plan (names and counts), the pre-checks as they stand now, and the step ledger. Read-only. */
export const tenantDeletionRunSchema = z.strictObject({
  request: tenantDeletionRequestSchema,
  /** Whether the runner may delete anything, and if not why: the kill switch is off, or the mail host is unset or a local capture (a mail accepted there proves no delivery). */
  enabled: z.boolean(),
  disabled_reason: z.enum(['kill_switch_off', 'mail_host_unset', 'local_mail_capture']).nullable().default(null),
  /** While a control plane restored from a backup has not yet outlived its hold: no request leaves `due` before this moment. */
  restore_hold_until: z.string().nullable().default(null),
  plan: z.strictObject({ digest: z.string(), database: z.string(), host: z.string(), backups: z.number().int().min(0), restore_copies: z.number().int().min(0), cards: z.number().int().min(0) }).nullable(),
  prechecks: z.strictObject({ blocked_by: z.string().nullable(), checks: z.array(z.strictObject({ code: z.string(), ok: z.boolean() })) }),
  steps: z.array(tenantDeletionStepRowSchema),
})
export const tenantDeletionRequestListSchema = z.strictObject({ items: z.array(tenantDeletionRequestSchema), total: z.number().int().min(0) })
export type TenantDeletion = z.infer<typeof tenantDeletionSchema>
export type TenantDeletionRequest = z.infer<typeof tenantDeletionRequestSchema>
export type TenantDeletionRun = z.infer<typeof tenantDeletionRunSchema>
export type TenantDeletionStepName = z.infer<typeof tenantDeletionStepSchema>
