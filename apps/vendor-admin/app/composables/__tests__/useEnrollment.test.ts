import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnrollment, type EnrollmentDeps } from '../useEnrollment'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'
const CODES = Array.from({ length: 10 }, (_, i) => `code-${String(i).padStart(4, '0')}-zzzz`.slice(0, 14))
const PASSWORD = 'correct horse battery'
const failure = (statusCode: number, code?: string) => Object.assign(new Error('fetch failed'), { statusCode, data: code ? { code } : undefined })

function setup(overrides: Partial<EnrollmentDeps> = {}, token: string | null = TOKEN) {
  const events: string[] = []
  const post = vi.fn(async (path: string) => {
    events.push(path)
    switch (path) {
      case '/api/auth/enroll/invitation': return { email: 'a@example.test', purpose: 'enroll' }
      case '/api/auth/enroll/passkey-options': return { challenge_id: 'c'.repeat(36), options: { challenge: 'x' } }
      case '/api/auth/enroll/totp': return { totp_uri: 'otpauth://totp/LiwanOS%3Aa?secret=JBSWY3DPEHPK3PXP&issuer=LiwanOS', totp_box: 'QUJD' }
      case '/api/auth/enroll/complete': return { recovery_codes: CODES, expires_at: 'x', idle_expires_at: 'y' }
      default: return undefined
    }
  })
  const register = vi.fn(async () => ({ id: 'attestation' }))
  const refresh = vi.fn(async () => undefined)
  const go = vi.fn()
  const takeToken = vi.fn(async () => { events.push('take-token'); return token })
  const enrollment = createEnrollment({ post: post as EnrollmentDeps['post'], register: register as unknown as EnrollmentDeps['register'], refresh, go, takeToken, ...overrides })
  return { enrollment, post, register, refresh, go, takeToken, events }
}

afterEach(() => vi.unstubAllGlobals())

describe('createEnrollment', () => {
  it('removes the fragment before the first network call', async () => {
    const { enrollment, events } = setup()
    await enrollment.start()
    expect(events[0]).toBe('take-token')
    expect(events[1]).toBe('/api/auth/enroll/invitation')
    expect(enrollment.step.value).toBe('passkey')
    expect(enrollment.email.value).toBe('a@example.test')
  })

  it('shows the invalid state and sends nothing when the address has no token', async () => {
    const { enrollment, post } = setup({}, null)
    await enrollment.start()
    expect(enrollment.step.value).toBe('invalid')
    expect(enrollment.errorKey.value).toBe('adminAuth.errors.failed')
    expect(post).not.toHaveBeenCalled()
  })

  it.each([
    [failure(401, 'auth_failed'), 'adminAuth.errors.failed'],
    [failure(422, 'invalid'), 'adminAuth.errors.invalid'],
  ])('shows the invalid state for a refused invitation %#', async (error, key) => {
    const { enrollment } = setup({ post: vi.fn().mockRejectedValue(error) as unknown as EnrollmentDeps['post'] })
    await enrollment.start()
    expect(enrollment.step.value).toBe('invalid')
    expect(enrollment.errorKey.value).toBe(key)
  })

  it.each([
    [failure(429, 'rate_limited'), 'adminAuth.errors.rateLimited'],
    [failure(503, 'admin_unavailable'), 'adminAuth.errors.unavailable'],
    [new TypeError('Failed to fetch'), 'adminAuth.errors.generic'],
  ])('keeps the link and offers a retry when the check itself fails %#', async (error, key) => {
    const base = setup().post
    let calls = 0
    const post = vi.fn(async (path: string) => { if (calls++ === 0) throw error; return base(path) })
    const { enrollment, takeToken } = setup({ post: post as unknown as EnrollmentDeps['post'] })
    await enrollment.start()
    expect(enrollment.step.value).toBe('retry')
    expect(enrollment.errorKey.value).toBe(key)
    await enrollment.checkInvitation()
    expect(enrollment.step.value).toBe('passkey')
    expect(takeToken).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenLastCalledWith('/api/auth/enroll/invitation', { token: TOKEN })
  })

  it('registers the passkey with the device label and moves on to the authenticator step', async () => {
    const { enrollment, post, register } = setup()
    await enrollment.start()
    enrollment.label.value = 'Work laptop'
    await enrollment.registerPasskey()
    expect(register).toHaveBeenCalledWith({ optionsJSON: { challenge: 'x' } })
    expect(post).toHaveBeenCalledWith('/api/auth/enroll/passkey-verify', { token: TOKEN, challenge_id: 'c'.repeat(36), response: { id: 'attestation' }, label: 'Work laptop' })
    expect(post).toHaveBeenCalledWith('/api/auth/enroll/totp', { token: TOKEN })
    expect(enrollment.step.value).toBe('totp')
    expect(enrollment.totpSecret.value).toBe('JBSW Y3DP EHPK 3PXP')
    expect(enrollment.totpUri.value).toMatch(/^otpauth:\/\/totp\//)
  })

  it('stays on the passkey step with a message when the prompt is cancelled', async () => {
    const { enrollment, post } = setup({ register: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' })) as unknown as EnrollmentDeps['register'] })
    await enrollment.start()
    await enrollment.registerPasskey()
    expect(enrollment.step.value).toBe('passkey')
    expect(enrollment.errorKey.value).toBe('adminAuth.errors.passkeyCancelled')
    expect(post).not.toHaveBeenCalledWith('/api/auth/enroll/passkey-verify', expect.anything())
  })

  it('lets the person ask for the authenticator setup again without registering a second passkey', async () => {
    let totpCalls = 0
    const base = setup().post
    const post = vi.fn(async (path: string) => {
      if (path === '/api/auth/enroll/totp' && totpCalls++ === 0) throw failure(503, 'admin_unavailable')
      return base(path)
    })
    const { enrollment, register } = setup({ post: post as unknown as EnrollmentDeps['post'] })
    await enrollment.start()
    await enrollment.registerPasskey()
    expect(enrollment.step.value).toBe('totp')
    expect(enrollment.totpUri.value).toBeNull()
    expect(enrollment.errorKey.value).toBe('adminAuth.errors.unavailable')
    await enrollment.loadTotp()
    expect(enrollment.totpUri.value).not.toBeNull()
    expect(enrollment.errorKey.value).toBeNull()
    expect(register).toHaveBeenCalledTimes(1)
  })

  async function reachTotp() {
    const parts = setup()
    await parts.enrollment.start()
    await parts.enrollment.registerPasskey()
    return parts
  }

  it('completes with the password and code, keeps the recovery codes in memory only and wipes the secrets', async () => {
    const { enrollment, post } = await reachTotp()
    Object.assign(enrollment.form, { password: PASSWORD, confirm: PASSWORD, totpCode: '123456' })
    await enrollment.complete()
    expect(post).toHaveBeenCalledWith('/api/auth/enroll/complete', { token: TOKEN, password: PASSWORD, totp_code: '123456', totp_box: 'QUJD' })
    expect(enrollment.step.value).toBe('recovery')
    expect(enrollment.recoveryCodes.value).toEqual(CODES)
    expect(enrollment.form).toMatchObject({ password: '', confirm: '', totpCode: '' })
    expect(enrollment.totpUri.value).toBeNull()
  })

  it('does not send a short password or a mismatched confirmation', async () => {
    const { enrollment, post } = await reachTotp()
    post.mockClear()
    Object.assign(enrollment.form, { password: 'short', confirm: 'short', totpCode: '123456' })
    await enrollment.complete()
    expect(enrollment.errorKey.value).toBe('adminAuth.enroll.errors.passwordShort')
    Object.assign(enrollment.form, { password: PASSWORD, confirm: `${PASSWORD}x`, totpCode: '123456' })
    await enrollment.complete()
    expect(enrollment.errorKey.value).toBe('adminAuth.enroll.errors.passwordMismatch')
    expect(post).not.toHaveBeenCalled()
  })

  it('shows a refused code and stays on the authenticator step', async () => {
    const base = setup().post
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('/complete')) throw failure(422, 'invalid')
      return base(path)
    })
    const { enrollment } = setup({ post: post as unknown as EnrollmentDeps['post'] })
    await enrollment.start()
    await enrollment.registerPasskey()
    Object.assign(enrollment.form, { password: PASSWORD, confirm: PASSWORD, totpCode: '123456' })
    await enrollment.complete()
    expect(enrollment.step.value).toBe('totp')
    expect(enrollment.errorKey.value).toBe('adminAuth.errors.invalid')
  })

  it('goes into the app only after the codes are confirmed saved', async () => {
    const { enrollment, go, refresh } = await reachTotp()
    Object.assign(enrollment.form, { password: PASSWORD, confirm: PASSWORD, totpCode: '123456' })
    await enrollment.complete()
    await enrollment.finish()
    expect(go).not.toHaveBeenCalled()
    enrollment.saved.value = true
    await enrollment.finish()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(go).toHaveBeenCalledWith('/')
    expect(enrollment.recoveryCodes.value).toEqual([])
  })

  it('shows a message and keeps the codes when entering the app fails, then succeeds on a second try', async () => {
    const refresh = vi.fn().mockRejectedValueOnce(failure(503, 'vendor_unavailable')).mockResolvedValue(undefined)
    const { enrollment, go } = setup({ refresh })
    await enrollment.start()
    await enrollment.registerPasskey()
    Object.assign(enrollment.form, { password: PASSWORD, confirm: PASSWORD, totpCode: '123456' })
    await enrollment.complete()
    enrollment.saved.value = true
    await enrollment.finish()
    expect(enrollment.errorKey.value).toBe('adminAuth.errors.unavailable')
    expect(enrollment.recoveryCodes.value).toEqual(CODES)
    expect(go).not.toHaveBeenCalled()
    await enrollment.finish()
    expect(go).toHaveBeenCalledWith('/')
    expect(enrollment.pending.value).toBe(false)
  })

  it('never writes the token, the password or the recovery codes to browser storage or the address', async () => {
    const writes = vi.fn()
    const storage = { setItem: writes, getItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() }
    const history = { pushState: writes, replaceState: writes }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', storage)
    vi.stubGlobal('history', history)
    const { enrollment } = await reachTotp()
    Object.assign(enrollment.form, { password: PASSWORD, confirm: PASSWORD, totpCode: '123456' })
    await enrollment.complete()
    enrollment.saved.value = true
    await enrollment.finish()
    expect(writes).not.toHaveBeenCalled()
  })
})
