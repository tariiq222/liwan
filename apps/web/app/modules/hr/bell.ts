import { HrLeaveBellRowSchema, HrOnboardingStepBellRowSchema, type HrLeaveBellRow } from '@liwan/contracts'

type Translate = (key: string, named?: Record<string, unknown>) => string

const TITLE_KEYS: Record<HrLeaveBellRow['kind'], string> = {
  'hr.leave_approved': 'hr.bell.leaveApproved',
  'hr.leave_refused': 'hr.bell.leaveRefused',
}

/**
 * The title of an HR bell row. The server sends the leave's date range or the step's summary; the sentence is worded
 * here, in the UI language. A row that does not match its contract shows its plain title instead of breaking the bell.
 */
export function hrBellTitle(row: Record<string, unknown>, t: Translate): string {
  const step = HrOnboardingStepBellRowSchema.safeParse(row)
  if (step.success) return t('hr.bell.onboardingStep', { step: step.data.title })
  const parsed = HrLeaveBellRowSchema.safeParse(row)
  if (!parsed.success) return typeof row.title === 'string' ? row.title : ''
  return t(TITLE_KEYS[parsed.data.kind], { dates: parsed.data.title })
}

/** The page a bell row opens: the employee's own leave of a decision row, or their onboarding tasks for a step row. */
export function hrBellHref(row: Record<string, unknown>): string | null {
  if (row.kind === 'hr.onboarding_step') return '/account/onboarding'
  return typeof row.leave_id === 'number' ? `/account/leave/${row.leave_id}` : null
}

/** The bell's title callback: it runs while the bell renders, so the app's own translator is at hand. */
export function hrBellTitleInApp(row: Record<string, unknown>): string {
  const { $i18n } = useNuxtApp()
  return hrBellTitle(row, (key, named) => $i18n.t(key, named ?? {}))
}
