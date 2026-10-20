import { FinanceZatcaErrorCodeSchema, FinanceZatcaOnboardInputSchema, type FinanceZatcaStatus } from '@webvue/contracts'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'
import { financeErrorMessage } from '../financeErrors'

export const OTP_LENGTH = 6

export const ZATCA_JOURNAL_TONE: Record<FinanceZatcaStatus['journals'][number]['state'], StatusTone> = {
  not_started: 'neutral',
  compliance_checked: 'info',
  onboarded: 'success',
}

const ERROR_CODES: readonly string[] = FinanceZatcaErrorCodeSchema.options

/** The one-time password as typed: digits only, at most six. */
export function otpDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, OTP_LENGTH)
}

export function isOtpValid(value: string): boolean {
  return FinanceZatcaOnboardInputSchema.safeParse({ otp: value }).success
}

/** The message to show for a failed onboarding: the user's language for a known code, else the server's own text. */
export function zatcaErrorMessage(cause: unknown, t: (key: string) => string): string {
  return financeErrorMessage(cause, code => ERROR_CODES.includes(code) ? `financeGovernance.zatca.errors.${code}` : null, t)
}

/** A backlog figure that needs a person's correction turns red when there is one; the others are the cron's work. */
export function backlogTone(id: keyof FinanceZatcaStatus['backlog'], count: number): 'neutral' | 'danger' {
  return (id === 'rejected' || id === 'blocked') && count > 0 ? 'danger' : 'neutral'
}
