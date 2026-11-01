import { ApiError } from '../composables/useApi'
import { saveErrorMessage } from './formFeedback'

// The refusals of launching a plan that name a missing person on the employee; the server's message is English.
const OWN_TEXT = new Set(['manager_missing', 'coach_missing'])

/** The text a refused plan launch shows: the Arabic wording of a missing manager or coach, otherwise the server's message. */
export function lifecycleLaunchErrorMessage(error: unknown, t: (key: string) => string, fallback: string): string {
  if (error instanceof ApiError && OWN_TEXT.has(error.code)) return t(`hr.lifecycleErrors.${error.code}`)
  return saveErrorMessage(error, fallback, t('errors.saveUncertain'))
}
