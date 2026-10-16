// Maps a failed sign-in, enrollment or step-up call to the locale key shown to the person. The
// BFF answers with a machine code only and never says why a sign-in failed, so the wording is
// chosen here; an error's own message is never shown (it can carry request material).

export function statusOf(error: unknown): number | undefined {
  const e = error as { statusCode?: number, response?: { status?: number } } | null
  return e?.statusCode ?? e?.response?.status
}

function codeOf(error: unknown): string | undefined {
  return (error as { data?: { code?: string } } | null)?.data?.code
}

const BROWSER_ERRORS: Record<string, string> = {
  NotAllowedError: 'adminAuth.errors.passkeyCancelled',
  InvalidStateError: 'adminAuth.errors.passkeyExists',
  NotSupportedError: 'adminAuth.errors.passkeyUnsupported',
}

export function authErrorKey(error: unknown): string {
  const code = codeOf(error)
  const status = statusOf(error)
  if (status === 429 || code === 'rate_limited') return 'adminAuth.errors.rateLimited'
  if (status === 503 || code === 'admin_unavailable' || code === 'vendor_unavailable') return 'adminAuth.errors.unavailable'
  if (status === 422 || code === 'invalid') return 'adminAuth.errors.invalid'
  if (status === 401 || code === 'auth_failed') return 'adminAuth.errors.failed'
  const name = (error as { name?: unknown } | null)?.name
  return (typeof name === 'string' && BROWSER_ERRORS[name]) || 'adminAuth.errors.generic'
}
