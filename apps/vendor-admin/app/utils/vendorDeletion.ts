import { tenantDeletionStepNames, type TenantDeletionRequest, type TenantDeletionStepName } from '@liwan/commercial-contracts'

/** The request states the customer page shows: an open request or a finished deletion. A withdrawn one is history, unless its access was already stopped (`deleting_at` is set): its reinstatement must stay visible until it is done. */
const SHOWN_STATES: ReadonlyArray<TenantDeletionRequest['state']> = ['requested', 'confirmed', 'due', 'deleting', 'deleted']
export const isDeletionShown = (request: TenantDeletionRequest | null | undefined): request is TenantDeletionRequest =>
  Boolean(request && (SHOWN_STATES.includes(request.state) || (request.state === 'withdrawn' && request.deleting_at !== null)))

/** The vendor may withdraw until the point of no return: while the request is open, and while a running deletion has not committed. */
export function deletionWithdrawable(request: TenantDeletionRequest): boolean {
  return ['requested', 'confirmed', 'due'].includes(request.state) || (request.state === 'deleting' && request.committed_at === null)
}

/** `stuck_code` is `<step>:<code>` while the deletion is stuck or deferred; the step is validated against the contract, never trusted as a locale key. */
export function stuckParts(request: TenantDeletionRequest): { step: TenantDeletionStepName | null; code: string } | null {
  if (!request.stuck_code) return null
  const [first = '', ...rest] = request.stuck_code.split(':')
  const known = (tenantDeletionStepNames as readonly string[]).includes(first)
  return known && rest.length ? { step: first as TenantDeletionStepName, code: rest.join(':') } : { step: null, code: request.stuck_code }
}

/** Every code the deletion runner, its effect scripts and its pre-checks can report; each has a sentence in `vendor.customers.deletion.run.codes` or `.checks`. */
const DELETION_CODES = [
  'access_not_stopped',
  'artifact_path_invalid',
  'artifact_root_unavailable',
  'authority_lost',
  'backup_id_invalid',
  'binding_changed',
  'binding_found',
  'binding_unavailable',
  'card_delete_failed',
  'card_not_deleted',
  'control_plane_restored',
  'database_absent',
  'database_blocklisted',
  'database_command_failed',
  'database_drop_failed',
  'database_fence_failed',
  'database_fence_unproven',
  'database_filestore_mismatch',
  'database_is_control_plane',
  'database_is_scratch_copy',
  'database_missing',
  'database_name_invalid',
  'database_still_present',
  'deletion_authority_lost',
  'deletion_lease_lost',
  'deletion_state_changed',
  'deletion_worker_stopping',
  'effect_timeout',
  'files_command_failed',
  'files_still_present',
  'filestore_ambiguous',
  'final_mail_pending',
  'final_mail_unsent',
  'hold_not_served',
  'host_invalid',
  'identity_base_url_mismatch',
  'identity_base_url_not_frozen',
  'identity_company_mismatch',
  'identity_marker_mismatch',
  'identity_marker_missing',
  'identity_profile_count',
  'identity_profile_mode',
  'identity_query_failed',
  'input_invalid',
  'kill_switch_off',
  'last_call_delivered',
  'marker_missing_needs_operator',
  'name_invalid',
  'not_committed',
  'not_configured',
  'offsite_not_empty',
  'operation_unavailable',
  'path_invalid',
  'path_symlink',
  'payment_adapter_unavailable',
  'plan_changed',
  'plan_digest_mismatch',
  'plan_invalid',
  'relay_not_configured',
  'release_operation_blocked',
  'remove_failed',
  'restore_copy_marker_mismatch',
  'restore_copy_marker_missing',
  'restore_copy_unreadable',
  'restore_target_invalid',
  'runtime_invalid',
  'script_failed',
  'step_failed',
  'tenant_binding_unavailable',
  'tenant_drop_failed',
] as const
const DELETION_CHECKS = [
  'binding_found',
  'due_notice_delivered',
  'no_charging_renewal',
  'no_free_base_lock',
  'no_payment_after_due',
  'no_payment_in_flight',
  'no_restore_pending',
  'no_shared_job',
  'no_transfer_pending',
  'no_unfulfilled_order',
] as const
/** `check` is the locale key of the unmet check, `code` the raw code of an unknown cause; the caller translates the key and passes both as named parameters. */
export type DeletionCodeText = { key: string; check?: string; code?: string }

/** The locale key of a runner code: a known cause, a pre-check that is not met, or one generic sentence that still carries the raw code for support. */
export function deletionCodeText(code: string): DeletionCodeText {
  if ((DELETION_CODES as readonly string[]).includes(code)) return { key: `vendor.customers.deletion.run.codes.${code}` }
  if ((DELETION_CHECKS as readonly string[]).includes(code)) return { key: 'vendor.customers.deletion.run.checkUnmet', check: `vendor.customers.deletion.run.checks.${code}` }
  return { key: 'vendor.customers.deletion.run.codeUnknown', code }
}
/** The name of a pre-check as the checks list shows it; an unknown check keeps its raw code. */
export const deletionCheckKey = (code: string): string | null =>
  (DELETION_CHECKS as readonly string[]).includes(code) ? `vendor.customers.deletion.run.checks.${code}` : null
