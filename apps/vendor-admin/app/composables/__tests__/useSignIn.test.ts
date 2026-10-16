import { describe, expect, it, vi } from 'vitest'
import { createSignIn, type SignInDeps } from '../useSignIn'

const failure = (statusCode: number, code?: string) => Object.assign(new Error('fetch failed'), { statusCode, data: code ? { code } : undefined })
const EXPIRY = { expires_at: '2026-10-16T20:00:00Z', idle_expires_at: '2026-10-16T08:30:00Z' }

function setup(next: unknown = undefined, overrides: Partial<SignInDeps> = {}) {
  const post = vi.fn(async (path: string) => path === '/api/auth/passkey-options' ? { challenge_id: 'c'.repeat(36), options: { challenge: 'x' } } : EXPIRY)
  const authenticate = vi.fn(async () => ({ id: 'assertion' }))
  const refresh = vi.fn(async () => undefined)
  const go = vi.fn()
  const signIn = createSignIn({ post: post as SignInDeps['post'], authenticate: authenticate as unknown as SignInDeps['authenticate'], refresh, go, next: () => next, ...overrides })
  return { signIn, post, authenticate, refresh, go }
}

describe('createSignIn with a passkey', () => {
  it('requests options, asks the browser for an assertion, verifies it, loads the profile and goes home', async () => {
    const { signIn, post, authenticate, refresh, go } = setup()
    await signIn.signInWithPasskey()
    expect(post.mock.calls).toEqual([
      ['/api/auth/passkey-options', {}],
      ['/api/auth/passkey-verify', { challenge_id: 'c'.repeat(36), response: { id: 'assertion' } }],
    ])
    expect(authenticate).toHaveBeenCalledWith({ optionsJSON: { challenge: 'x' } })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(go).toHaveBeenCalledWith('/')
    expect(signIn.errorKey.value).toBeNull()
    expect(signIn.pending.value).toBe(false)
  })

  it('returns to a safe next path and ignores an unsafe one', async () => {
    const safe = setup('/audit?page=2')
    await safe.signIn.signInWithPasskey()
    expect(safe.go).toHaveBeenCalledWith('/audit?page=2')
    for (const bad of ['//evil.example', 'javascript:alert(1)', 'https://evil.example/x']) {
      const unsafe = setup(bad)
      await unsafe.signIn.signInWithPasskey()
      expect(unsafe.go).toHaveBeenCalledWith('/')
    }
  })

  it('shows the cancelled-prompt message and stays on the page', async () => {
    const { signIn, go, post } = setup(undefined, { authenticate: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' })) as unknown as SignInDeps['authenticate'] })
    await signIn.signInWithPasskey()
    expect(signIn.errorKey.value).toBe('adminAuth.errors.passkeyCancelled')
    expect(go).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it.each([
    [failure(401, 'auth_failed'), 'adminAuth.errors.failed'],
    [failure(429, 'rate_limited'), 'adminAuth.errors.rateLimited'],
    [failure(503, 'vendor_unavailable'), 'adminAuth.errors.unavailable'],
  ])('maps the failed verification %# to its message', async (error, key) => {
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('verify')) throw error
      return { challenge_id: 'c'.repeat(36), options: {} }
    })
    const { signIn, go } = setup(undefined, { post: post as unknown as SignInDeps['post'] })
    await signIn.signInWithPasskey()
    expect(signIn.errorKey.value).toBe(key)
    expect(go).not.toHaveBeenCalled()
  })

  it('ignores a second click while one attempt is running', async () => {
    let release!: () => void
    const post = vi.fn()
      .mockImplementationOnce(() => new Promise<unknown>((resolve) => { release = () => resolve({ challenge_id: 'c'.repeat(36), options: {} }) }))
      .mockResolvedValue(EXPIRY)
    const { signIn } = setup(undefined, { post: post as unknown as SignInDeps['post'] })
    const first = signIn.signInWithPasskey()
    await signIn.signInWithPasskey()
    expect(post).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(post).toHaveBeenCalledTimes(2)
  })
})

describe('createSignIn with a password', () => {
  it('signs in with password and authenticator code', async () => {
    const { signIn, post, go } = setup('/tenants')
    signIn.setMode('fallback')
    Object.assign(signIn.form, { email: ' A@Example.test ', password: 'correct horse battery', totpCode: '123456' })
    await signIn.signInWithPassword()
    expect(post).toHaveBeenCalledWith('/api/auth/fallback', { email: 'A@Example.test', password: 'correct horse battery', totp_code: '123456' })
    expect(go).toHaveBeenCalledWith('/tenants')
    expect(signIn.form.password).toBe('')
    expect(signIn.form.totpCode).toBe('')
  })

  it('signs in with a recovery code', async () => {
    const { signIn, post } = setup()
    signIn.setMode('recovery')
    Object.assign(signIn.form, { email: 'a@example.test', password: 'correct horse battery', recoveryCode: ' abcd-efgh-jkmn ' })
    await signIn.signInWithPassword()
    expect(post).toHaveBeenCalledWith('/api/auth/recovery', { email: 'a@example.test', password: 'correct horse battery', recovery_code: 'abcd-efgh-jkmn' })
  })

  it('shows the same message for a wrong password as for an unknown email', async () => {
    const messages: Array<string | null> = []
    for (const body of [{ code: 'auth_failed' }, { code: 'auth_failed' }]) {
      const { signIn } = setup(undefined, { post: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { statusCode: 401, data: body })) as unknown as SignInDeps['post'] })
      signIn.setMode('fallback')
      await signIn.signInWithPassword()
      messages.push(signIn.errorKey.value)
    }
    expect(messages).toEqual(['adminAuth.errors.failed', 'adminAuth.errors.failed'])
  })

  it('shows the lockout message on the sixth failure', async () => {
    const { signIn } = setup(undefined, { post: vi.fn().mockRejectedValue(failure(429, 'rate_limited')) as unknown as SignInDeps['post'] })
    signIn.setMode('fallback')
    await signIn.signInWithPassword()
    expect(signIn.errorKey.value).toBe('adminAuth.errors.rateLimited')
  })

  it('clears the one-time codes but keeps the email after a failure', async () => {
    const { signIn } = setup(undefined, { post: vi.fn().mockRejectedValue(failure(401, 'auth_failed')) as unknown as SignInDeps['post'] })
    signIn.setMode('recovery')
    Object.assign(signIn.form, { email: 'a@example.test', password: 'correct horse battery', totpCode: '123456', recoveryCode: 'abcd-efgh-jkmn' })
    await signIn.signInWithPassword()
    expect(signIn.form).toMatchObject({ email: 'a@example.test', totpCode: '', recoveryCode: '' })
  })

  it('clears the message when the person switches the way to sign in', async () => {
    const { signIn } = setup(undefined, { post: vi.fn().mockRejectedValue(failure(401, 'auth_failed')) as unknown as SignInDeps['post'] })
    signIn.setMode('fallback')
    await signIn.signInWithPassword()
    expect(signIn.errorKey.value).not.toBeNull()
    signIn.setMode('recovery')
    expect(signIn.errorKey.value).toBeNull()
    expect(signIn.mode.value).toBe('recovery')
  })
})
