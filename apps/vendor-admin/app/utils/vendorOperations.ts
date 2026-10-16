import { operationListStatusSchema, type OperationListStatus } from '@nasq/commercial-contracts'

/** The status choices of the operations list; any other valid status stays usable from a link (the overview, a tenant). */
export const OPERATION_STATUS_FILTERS = ['all', 'pending', 'attention', 'succeeded', 'verified'] as const
const GROUPS: readonly string[] = ['all', 'pending', 'attention']

/** The `status` query value as a filter; anything the control plane would reject reads as no filter. */
export function operationStatusFilter(value: unknown): OperationListStatus | 'all' {
  const parsed = operationListStatusSchema.safeParse(value)
  return parsed.success ? parsed.data : 'all'
}

/** Groups have their own wording; a single status reuses the status badge label. */
export const operationFilterLabelKey = (value: string): string => (GROUPS.includes(value) ? `vendor.operations.filter.${value}` : `vendor.status.${value}`)
