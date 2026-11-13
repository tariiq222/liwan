// Cloudflare Turnstile server-side check. The control plane is the only verifier: the secret never reaches the browser
// or the web tier, and the visitor's address from the signed forward is sent so the token is bound to that client.
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const VERIFY_TIMEOUT_MS = 5_000
const SITE_KEY = /^[0-9A-Za-z_-]{8,100}$/

/** Resolves true for a valid single-use token and false for a rejected one. Rejects when the answer cannot be had. */
export type HumanCheck = (token: string, ip: string) => Promise<boolean>
export type HumanCheckSettings = { siteKey: string; scriptUrl: string; verify: HumanCheck }

export function humanCheckFromEnv(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): HumanCheckSettings {
  const siteKey = env.LIWAN_SIGNUP_TURNSTILE_SITE_KEY?.trim() ?? ''
  const secret = env.LIWAN_SIGNUP_TURNSTILE_SECRET_KEY?.trim() ?? ''
  if (!SITE_KEY.test(siteKey) || secret.length < 8) throw new Error('signup_configuration_invalid')
  return { siteKey, scriptUrl: TURNSTILE_SCRIPT_URL, verify: turnstileVerifier(secret, fetchImpl) }
}

export function turnstileVerifier(secret: string, fetchImpl: typeof fetch = fetch): HumanCheck {
  return async (token, ip) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
    try {
      const response = await fetchImpl(SITEVERIFY_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ secret, response: token, remoteip: ip }), redirect: 'error', signal: controller.signal,
      })
      if (!response.ok) throw new Error('human_check_unavailable')
      const answer = await response.json() as { success?: unknown } | null
      if (typeof answer?.success !== 'boolean') throw new Error('human_check_unavailable')
      return answer.success
    } catch {
      // Timeouts, network and parse errors fail closed; none of them may carry the secret or the token into a log.
      throw new Error('human_check_unavailable')
    } finally {
      clearTimeout(timeout)
    }
  }
}
