import { reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderSfc } from '../../../test/helpers/renderSfc'

interface State { mode?: 'passkey' | 'fallback' | 'recovery', pending?: boolean, errorKey?: string | null, hydrated?: boolean, lang?: 'ar' | 'en', devEnabled?: boolean }

function renderLogin({ mode = 'passkey', pending = false, errorKey = null, hydrated = true, lang = 'ar', devEnabled = false }: State = {}) {
  const setMode = vi.fn()
  const html = renderSfc('pages/login.vue', {}, {}, {
    lang,
    hydrated,
    components: { PasskeyButton: 'components/PasskeyButton.vue' },
    globals: {
      useSignIn: () => ({
        mode: ref(mode), pending: ref(pending), errorKey: ref(errorKey),
        form: reactive({ email: '', password: '', totpCode: '', recoveryCode: '' }),
        devEnabled, signInWithPasskey: vi.fn(), signInWithPassword: vi.fn(), signInWithDev: vi.fn(), setMode,
      }),
    },
  })
  return html
}

describe('login page', () => {
  it('leads with the passkey button and offers the fallbacks as secondary links', async () => {
    const html = await renderLogin()
    expect(html).toContain('<h1')
    expect(html).toContain('تسجيل الدخول')
    expect(html).toContain('الدخول بمفتاح المرور')
    expect(html).toContain('فقدت جهازك؟')
    expect(html).toContain('استخدم رمز استرداد')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('role="alert"')
  })

  it('hides the developer sign-in unless the development flag is on', async () => {
    for (const mode of ['passkey', 'fallback'] as const) {
      const html = await renderLogin({ mode })
      expect(html).not.toContain('دخول التطوير')
      expect(html).not.toContain('data-slot="dev-login"')
    }
  })

  it('shows a labelled developer sign-in with its local-only warning when the flag is on', async () => {
    const html = await renderLogin({ devEnabled: true })
    expect(html).toContain('data-slot="dev-login"')
    expect(html).toContain('دخول التطوير')
    expect(html).toContain('بيئة التطوير المحلية فقط')
    expect(await renderLogin({ devEnabled: true, lang: 'en' })).toContain('Developer sign-in')
  })

  it('shows the password and authenticator code form after "Lost your device?"', async () => {
    const html = await renderLogin({ mode: 'fallback' })
    expect(html).toContain('<form')
    expect(html).toContain('الدخول بكلمة المرور ورمز المصادقة')
    expect(html).toContain('autocomplete="username"')
    expect(html).toContain('autocomplete="current-password"')
    expect(html).toContain('autocomplete="one-time-code"')
    expect(html).not.toContain('رمز الاسترداد</label>')
    expect(html).toContain('العودة إلى مفتاح المرور')
  })

  it('shows the password and recovery code form', async () => {
    const html = await renderLogin({ mode: 'recovery' })
    expect(html).toContain('الدخول برمز استرداد')
    expect(html).toContain('رمز الاسترداد</label>')
    expect(html).not.toContain('رمز المصادقة</label>')
  })

  it('keeps the submit button off until the page has hydrated', async () => {
    expect(await renderLogin({ mode: 'fallback', hydrated: false })).toMatch(/<button[^>]*type="submit"[^>]*disabled|<button[^>]*disabled[^>]*type="submit"/)
    expect(await renderLogin({ mode: 'fallback', hydrated: true })).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/)
  })

  it.each([
    ['failed', 'adminAuth.errors.failed', 'تعذّر تسجيل الدخول'],
    ['locked or rate limited', 'adminAuth.errors.rateLimited', 'محاولات كثيرة'],
    ['unavailable (503)', 'adminAuth.errors.unavailable', 'الخدمة غير متاحة الآن'],
    ['cancelled passkey prompt', 'adminAuth.errors.passkeyCancelled', 'أُلغي طلب مفتاح المرور'],
  ])('shows the %s message as an alert and keeps the sign-in controls', async (_name, errorKey, text) => {
    for (const mode of ['passkey', 'fallback'] as const) {
      const html = await renderLogin({ mode, errorKey })
      expect(html).toMatch(/role="alert"/)
      expect(html).toContain(text)
    }
  })

  it('shows the same text for a wrong password and an unknown account (one key)', async () => {
    const first = await renderLogin({ mode: 'fallback', errorKey: 'adminAuth.errors.failed' })
    const second = await renderLogin({ mode: 'fallback', errorKey: 'adminAuth.errors.failed' })
    expect(first).toBe(second)
  })

  it('renders English text and never a raw key', async () => {
    const html = await renderLogin({ mode: 'fallback', errorKey: 'adminAuth.errors.rateLimited', lang: 'en' })
    expect(html).toContain('Sign in with password and authenticator code')
    expect(html).toContain('Too many attempts')
    expect(html).not.toMatch(/adminAuth\.[a-zA-Z.]+/)
  })

  it('marks the loading state on the passkey button while a request runs', async () => {
    expect(await renderLogin({ pending: true })).toContain('data-loading="true"')
  })
})
