import { HrLeaveBellRowSchema, type HrLeaveBellRow } from '@webvue/contracts'

type Translate = (key: string, named?: Record<string, unknown>) => string

const TITLE_KEYS: Record<HrLeaveBellRow['kind'], string> = {
  'hr.leave_approved': 'hr.bell.leaveApproved',
  'hr.leave_refused': 'hr.bell.leaveRefused',
}

/**
 * The title of a leave-decision bell row. The server sends the leave's date range; the sentence is worded here,
 * in the UI language. A row that does not match the contract shows its plain title instead of breaking the bell.
 */
export function hrBellTitle(row: Record<string, unknown>, t: Translate): string {
  const parsed = HrLeaveBellRowSchema.safeParse(row)
  if (!parsed.success) return typeof row.title === 'string' ? row.title : ''
  return t(TITLE_KEYS[parsed.data.kind], { dates: parsed.data.title })
}

/** The leave page of a decision row, or null for a row without one. */
export function hrBellHref(row: Record<string, unknown>): string | null {
  return typeof row.leave_id === 'number' ? `/hr/leave/${row.leave_id}` : null
}

/** The bell's title callback: it runs while the bell renders, so the app's own translator is at hand. */
export function hrBellTitleInApp(row: Record<string, unknown>): string {
  const { $i18n } = useNuxtApp()
  return hrBellTitle(row, (key, named) => $i18n.t(key, named ?? {}))
}
