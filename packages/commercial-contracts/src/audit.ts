import { z } from 'zod'

const searchText = z.string().trim().min(1).max(200)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'Invalid date')

export const AUDIT_PAGE_SIZE = 25

/**
 * Every action the control plane writes to `audit_events`, except the operation events (`AUDIT_OPERATION_TYPES` by
 * `AUDIT_OPERATION_STATUSES`). The console has a text for each one; a control plane test fails when a source file writes an
 * action missing here, and a console test fails when one has no text in either language.
 */
export const AUDIT_ACTIONS = [
  'account.dev_owner', 'account.disabled', 'account.enabled', 'account.enrolled', 'account.invited', 'account.reset_completed', 'account.reset_issued', 'account.roles_set',
  'ai.platform_provider.models_listed', 'ai.platform_provider.redelivered', 'ai.platform_provider.saved', 'ai.platform_provider.tested', 'ai_billing.settings_updated', 'ai_topup.refunded',
  'auth.failed', 'auth.locked', 'auth.passkey_registered', 'auth.signed_in', 'auth.signed_out', 'auth.step_up',
  'auto_renew.disabled', 'auto_renew.enabled', 'auto_renew.not_enabled', 'billing.settings_updated',
  'bundle.created', 'bundle.deleted', 'bundle.edit', 'bundle.publish', 'bundle.restore', 'bundle.revision_created', 'bundle.validate', 'bundle.withdraw',
  'catalog.imported', 'catalog.publish', 'catalog.validate', 'catalog_release.created',
  'customer.admin_login_changed', 'customer_terms.created', 'free_base_lock.failed', 'invitation.reissued',
  'invoice.credit_pending', 'invoice.credit_refunded', 'invoice.refund_requested', 'invoice.voided', 'invoices.exported', 'order.accepted', 'order.cancelled',
  'payment.bank_transfer_duplicate', 'payment.bank_transfer_received', 'payment.card_not_saved', 'payment.direct_payment_missing', 'payment.duplicate_charge', 'payment.duplicate_refunded',
  'payment.form_attempt_closed', 'payment.form_attempt_needs_review', 'payment.form_declined', 'payment.form_hint_rejected', 'payment.form_payment_refunded', 'payment.form_payment_rejected',
  'payment.form_payment_searched', 'payment.form_rejection_suppressed', 'payment.form_search_rejected', 'payment.form_settled', 'payment.intervention', 'payment.refund_hold_released', 'payment.refund_rechecked', 'payment.refund_rejected',
  'payment.saved_card_charge_refused', 'payment.saved_card_declined', 'payment.saved_card_needs_customer_action', 'payment.saved_card_unusable', 'payment.token_orphan_deleted', 'payment.webhook_verification',
  'payment_method.removed', 'payment_method.saved',
  'plan.created', 'plan.deleted', 'plan.edit', 'plan.publish', 'plan.restore', 'plan.revision_created', 'plan.validate', 'plan.withdraw', 'plan.withdrawn_by_publish',
  'registry.recovery_requested', 'restore.approved',
  'shared_backup.verified', 'shared_job.abandon_refused', 'shared_job.abandon_requested', 'shared_job.abandoned', 'shared_job.enrollment_authority_invalid', 'shared_job.lease_expired',
  'shared_job.queued', 'shared_job.recovery_completed', 'shared_job.recovery_observed', 'shared_job.recovery_requested', 'shared_job.replayed',
  'shared_odoo_backup.verified', 'shared_odoo_restore.approved', 'shared_odoo_restore.publication_requested', 'shared_odoo_restore.route_published',
  'shared_onboarding.reserved', 'shared_order.created', 'shared_restore.completed',
  'subscription.cancel_requested', 'subscription.cancel_withdrawn', 'subscription.cancellation_effective', 'subscription.refund_lock_armed', 'subscription.resumed', 'subscription.suspended',
  'tenant.operations.disabled', 'tenant.operations.enabled', 'tenant.registered',
  'tenant_deletion.card_not_deleted', 'tenant_deletion.code_invalidated', 'tenant_deletion.code_sent', 'tenant_deletion.committed', 'tenant_deletion.confirmed', 'tenant_deletion.deleted',
  'tenant_deletion.deleting', 'tenant_deletion.due', 'tenant_deletion.hold_extended', 'tenant_deletion.hold_rearmed', 'tenant_deletion.hold_rearmed_after_restore', 'tenant_deletion.marker_stamped',
  'tenant_deletion.plan_refrozen', 'tenant_deletion.requested', 'tenant_deletion.returned_to_hold_after_restore', 'tenant_deletion.stuck', 'tenant_deletion.withdrawn',
  'trial.conversion_reverted', 'trial.converted', 'trial.ended', 'trial.enrolled', 'trial.expiry_push_failed', 'trial.extended', 'trial.lapsed', 'trial.policy_bootstrap_queued', 'trial.reopened', 'trial.started',
  'workspace.lookup.mailed',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** An operation event is `operation.<type>.<status>`: the status the worker settled the operation in, or `queued` when it was requested. */
export const AUDIT_OPERATION_TYPES = ['tenant.create', 'tenant.inspect', 'tenant.entitle', 'health', 'backup', 'upgrade', 'restore'] as const
export const AUDIT_OPERATION_STATUSES = ['queued', 'succeeded', 'failed', 'needs_intervention'] as const

/**
 * GET /v1/audit query. `action` is an exact action or a family prefix (`order` matches `order.accepted`);
 * `customer_id` matches the customer and everything owned by it (workspace, subscriptions, orders).
 * `from`/`to` are inclusive calendar days in the business time zone Asia/Riyadh, the zone the console displays.
 * `q` and `actor` match action, reason, subject and account display names, never account emails.
 */
export const auditListQuerySchema = z.strictObject({
  q: searchText.optional(),
  action: z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/).optional(),
  actor: searchText.optional(),
  customer_id: z.uuid().optional(),
  from: day.optional(),
  to: day.optional(),
  page: z.string().regex(/^\d{1,5}$/).transform(Number).pipe(z.number().int().min(1).max(10000)).optional(),
}).refine(query => !query.from || !query.to || query.from <= query.to, { path: ['to'], message: 'The end day precedes the start day' })
export type AuditListQuery = z.infer<typeof auditListQuerySchema>

export const auditSubjectKindSchema = z.enum(['account', 'customer', 'tenant', 'order', 'subscription', 'invoice', 'adjustment', 'shared_job', 'plan', 'bundle', 'catalog', 'other'])
export type AuditSubjectKind = z.infer<typeof auditSubjectKindSchema>

/** What the stored subject string refers to; `name` is resolved server-side and null when the record is gone or unnamed. */
export const auditSubjectSchema = z.strictObject({
  kind: auditSubjectKindSchema, name: z.string().nullable(),
  customer_id: z.uuid().nullable(), tenant_id: z.uuid().nullable(),
  /** The invoice itself, or the invoice an adjustment belongs to; null for every other kind. */
  invoice_id: z.uuid().nullable(),
})

export const auditEventSchema = z.strictObject({
  id: z.uuid(), actor: z.string(), actor_name: z.string().nullable(), action: z.string(), subject: z.string(),
  subject_ref: auditSubjectSchema, reason: z.string(), created_at: z.iso.datetime(),
})
export type AuditEvent = z.infer<typeof auditEventSchema>
export const auditListSchema = z.strictObject({ items: z.array(auditEventSchema), total: z.number().int().nonnegative() })
export type AuditList = z.infer<typeof auditListSchema>
