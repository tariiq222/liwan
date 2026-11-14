import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { humanCheckFromEnv, turnstileVerifier } from './human-check.js'
import { signupFromEnv } from './http.js'

const secret = 'secret-fixture'
const ip = '192.0.2.9'
const call = (fetcher: typeof fetch, token = 'tok') => turnstileVerifier(secret, fetcher)(token, ip)

describe('turnstileVerifier', () => {
  it('posts the secret, token and client address, and returns the verdict', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true }))
    await expect(call(fetcher)).resolves.toBe(true)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(JSON.parse(init!.body as string)).toEqual({ secret, response: 'tok', remoteip: ip })
    expect(init!.redirect).toBe('error')
    expect(init!.signal).toBeInstanceOf(AbortSignal)
    await expect(call(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] })))).resolves.toBe(false)
  })

  it('does not cache: the same token is sent to the verifier every time', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ success: true }))
    await call(fetcher); await call(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('fails closed on network errors, bad statuses, malformed answers and timeouts, without leaking the secret', async () => {
    const bad: Array<typeof fetch> = [
      vi.fn<typeof fetch>().mockRejectedValue(new Error(`boom ${secret}`)),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('no', { status: 503 })),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('not json', { status: 200 })),
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({})),
    ]
    for (const fetcher of bad) await expect(call(fetcher)).rejects.toThrow(/^human_check_unavailable$/)
    vi.useFakeTimers()
    try {
      const hang: typeof fetch = (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))))
      const pending = expect(call(hang)).rejects.toThrow('human_check_unavailable')
      await vi.advanceTimersByTimeAsync(5_001)
      await pending
    } finally { vi.useRealTimers() }
  })
})

describe('sign-up bot-check configuration', () => {
  const keys = { LIWAN_SIGNUP_TURNSTILE_SITE_KEY: '0x4AAAAAAAfixture', LIWAN_SIGNUP_TURNSTILE_SECRET_KEY: 'secret-fixture' }
  it('reads the site key and builds a verifier', () => {
    const settings = humanCheckFromEnv(keys)
    expect(settings.siteKey).toBe('0x4AAAAAAAfixture')
    expect(settings.scriptUrl).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js')
  })

  it('refuses a missing or malformed key, which keeps sign-up off', () => {
    const bad = [{}, { LIWAN_SIGNUP_TURNSTILE_SITE_KEY: keys.LIWAN_SIGNUP_TURNSTILE_SITE_KEY },
      { LIWAN_SIGNUP_TURNSTILE_SECRET_KEY: keys.LIWAN_SIGNUP_TURNSTILE_SECRET_KEY },
      { ...keys, LIWAN_SIGNUP_TURNSTILE_SITE_KEY: 'bad key!' }, { ...keys, LIWAN_SIGNUP_TURNSTILE_SECRET_KEY: ' ' }]
    for (const env of bad) expect(() => humanCheckFromEnv(env), JSON.stringify(env)).toThrow('signup_configuration_invalid')
  })

  it('signupFromEnv throws signup_configuration_invalid without the bot-check keys', () => {
    const env = {
      LIWAN_PUBLIC_SIGNUP: 'true', LIWAN_TENANCY_MODE: 'shared', LIWAN_SIGNUP_PLAN_REVISION_ID: '6f1c3d8e-0000-4000-8000-000000000001',
      LIWAN_SIGNUP_AUTHENTICA_KEY: 'key', LIWAN_SIGNUP_AUTHENTICA_TEMPLATE_ID: '7', LIWAN_MAIL_MODE: 'disabled',
      LIWAN_SIGNUP_LEGAL_BASE_URL: 'https://liwanos.com', LIWAN_SIGNUP_TERMS_VERSION: '2026-11-01',
    }
    expect(() => signupFromEnv({} as Pool, 's'.repeat(32), env)).toThrow('signup_configuration_invalid')
    // With the keys present the next gate is the mail setting, proving the bot-check gate passed.
    expect(() => signupFromEnv({} as Pool, 's'.repeat(32), { ...env, ...keys })).toThrow('signup_email_unavailable')
  })
})
