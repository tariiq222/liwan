import { OperationBellRowSchema, type OperationBellRow } from '@liwan/contracts'

type Translate = (key: string, named?: Record<string, unknown>) => string

const TITLE_KEYS: Record<OperationBellRow['kind'], string> = {
  'operations.review_requested': 'operations.bell.reviewRequested',
  'operations.approved': 'operations.bell.approved',
  'operations.rejected': 'operations.bell.rejected',
  'operations.returned': 'operations.bell.returned',
}

/**
 * The title of an operations bell row. The server sends the request's name; the sentence is worded here, in the UI
 * language. A row that does not match the contract shows its plain title instead of breaking the bell.
 */
export function operationBellTitle(row: Record<string, unknown>, t: Translate): string {
  const parsed = OperationBellRowSchema.safeParse(row)
  if (!parsed.success) return typeof row.title === 'string' ? row.title : ''
  return t(TITLE_KEYS[parsed.data.kind], { name: parsed.data.title })
}

/** The request page of an operations row, or null for a row without one. */
export function operationBellHref(row: Record<string, unknown>): string | null {
  return typeof row.request_id === 'number' ? `/operations/${row.request_id}` : null
}

/** The bell's title callback: it runs while the bell renders, so the app's own translator is at hand. */
export function operationBellTitleInApp(row: Record<string, unknown>): string {
  const { $i18n } = useNuxtApp()
  return operationBellTitle(row, (key, named) => $i18n.t(key, named ?? {}))
}
