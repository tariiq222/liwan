import type { FinanceZatcaSubmission } from '@liwan/contracts'

/** Seconds until the server lets the next manual ZATCA retry run (0 when it can run now or the document is final). */
export function zatcaRetryWaitSeconds(submission: Pick<FinanceZatcaSubmission, 'next_retry_at'>, now: number): number {
  if (!submission.next_retry_at) return 0
  return Math.max(0, Math.ceil((Date.parse(submission.next_retry_at) - now) / 1000))
}
