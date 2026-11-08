import { DOUBLE_STEP_ERROR_CODES, type DoubleStepErrorCode, type LoginChannel, type LoginChannels } from '@liwan/contracts'

/** The message key of every machine code the two steps can answer with.
 * The record is keyed by the contract's own code list, so a code the server can answer with and this map does not
 * know fails to type-check; `errorKey` still falls back for an unlisted answer (a proxy-level failure).
 * `invalid_channel` deliberately reads as `channel_unavailable`: the page only ever sends a channel the server
 * offered, so the two describe one state — a channel that cannot take this code. */
export const ERROR_KEYS: Record<DoubleStepErrorCode, string> = {
  invalid_credentials: 'auth.invalidCredentials',
  invalid_code: 'auth.codeInvalid',
  invalid_code_format: 'auth.codeFormat',
  invalid_device: 'auth.deviceInvalid',
  no_pending_login: 'auth.noPendingLogin',
  resend_cooldown: 'auth.resendCooldown',
  send_limit_reached: 'auth.sendLimitReached',
  daily_send_cap: 'auth.dailySendCap',
  channel_unavailable: 'auth.channelUnavailable',
  invalid_channel: 'auth.channelUnavailable',
  tenant_suspended: 'auth.tenantSuspended',
  login_refused: 'auth.loginRefused',
}

/** The key of a refusal: the code's own sentence, else the caller's fallback (the generic sign-in failure by default). */
export function errorKey(code: string | null | undefined, fallback = 'auth.loginFailed'): string {
  const known = code && (DOUBLE_STEP_ERROR_CODES as readonly string[]).includes(code) ? code as DoubleStepErrorCode : null
  return known ? ERROR_KEYS[known] : fallback
}

/** The machine code a Nitro refusal carries: `{ statusCode, data: { code } }` (an upstream body may nest it once). */
export function errorCode(error: unknown): string | undefined {
  const data = (error as { data?: { code?: unknown; data?: { code?: unknown } } } | null | undefined)?.data
  const code = data?.code ?? data?.data?.code
  return typeof code === 'string' ? code : undefined
}

/** The refusal's details (`{resend_after}` for a cooldown), wherever the envelope put them. */
export function errorDetails(error: unknown): Record<string, unknown> | undefined {
  const data = (error as { data?: { details?: unknown; data?: { details?: unknown } } } | null | undefined)?.data
  const details = data?.details ?? data?.data?.details
  return details && typeof details === 'object' ? details as Record<string, unknown> : undefined
}

/** The seconds a refusal asks the page to wait, 0 when it names none. */
export function errorSeconds(error: unknown): number {
  const value = Number(errorDetails(error)?.resend_after ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0
}

/** Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits as ASCII digits, as the server normalizes them. */
export function asciiDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
}

/** The six ASCII digits of VALUE, or null when it is not a well-formed code. A keyboard in an Arabic locale
 * types Arabic-Indic digits, and a pasted code may carry spaces or the invisible bidi marks a mixed-direction
 * message leaves behind; the client cleans both and always sends ASCII digits. */
export function normalizeCode(value: string): string | null {
  const digits = asciiDigits(value).replace(/[\s\u200e\u200f\u061c\u2066-\u2069]/g, '')
  return /^[0-9]{6}$/.test(digits) ? digits : null
}

/** Whether VALUE is a code worth sending: a well-formed one in either digit set. */
export function isCompleteCode(value: string): boolean {
  return normalizeCode(value) !== null
}

/** The whole seconds left before `deadline` at `now`, never negative. Rounded up, so it reaches 0 exactly at the
 * deadline and the resend stays disabled for the server's full wait. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

/** The channels this pending sign-in can really use: SMS needs the tenant's provider and the account's number,
 * email needs the account's address. The server's own order is kept. */
export function offeredChannels(answer: LoginChannels): LoginChannel[] {
  return answer.channels.filter(channel => (channel === 'sms'
    ? answer.sms_available && answer.has_mobile
    : answer.has_email))
}

/** The channel the first code goes to: the first one the server offers (it lists SMS before email). */
export function preferredChannel(offered: readonly LoginChannel[]): LoginChannel | null {
  return offered[0] ?? null
}

/** Whether SMS is missing from the tenant's own list, so the page says so instead of offering it. */
export function smsUnavailable(answer: LoginChannels): boolean {
  return !answer.channels.includes('sms')
}
