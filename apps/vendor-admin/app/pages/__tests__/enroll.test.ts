import { reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderSfc } from '../../../test/helpers/renderSfc'
import type { EnrollmentStep } from '../../composables/useEnrollment'

interface State {
  step: EnrollmentStep
  errorKey?: string | null
  totpUri?: string | null
  codes?: string[]
  saved?: boolean
  lang?: 'ar' | 'en'
}

const URI = 'otpauth://totp/WebVue%3Aa?secret=JBSWY3DPEHPK3PXP&issuer=WebVue'

function renderEnroll({ step, errorKey = null, totpUri = null, codes = [], saved = false, lang = 'ar' }: State) {
  return renderSfc('pages/enroll.vue', {}, {}, {
    lang,
    components: { PasskeyButton: 'components/PasskeyButton.vue', TotpSetup: 'components/TotpSetup.vue', RecoveryCodes: 'components/RecoveryCodes.vue' },
    globals: {
      useEnrollment: () => ({
        step: ref(step), pending: ref(false), errorKey: ref(errorKey), email: ref('a@example.test'), label: ref(''),
        totpUri: ref(totpUri), totpSecret: ref(totpUri ? 'JBSW Y3DP EHPK 3PXP' : null),
        form: reactive({ password: '', confirm: '', totpCode: '' }), recoveryCodes: ref(codes), saved: ref(saved),
        start: vi.fn(), loadTotp: vi.fn(), registerPasskey: vi.fn(), complete: vi.fn(), finish: vi.fn(),
      }),
    },
  })
}

describe('enrollment page', () => {
  it('says it is checking the invitation first', async () => {
    const html = await renderEnroll({ step: 'checking' })
    expect(html).toContain('جارٍ التحقق من الدعوة')
    expect(html).not.toContain('<form')
  })

  it('explains an invalid or expired link without a form', async () => {
    const html = await renderEnroll({ step: 'invalid', errorKey: 'adminAuth.errors.failed' })
    expect(html).toContain('رابط الدعوة غير صالح')
    expect(html).toContain('اطلب من المالك دعوة جديدة')
    expect(html).toContain('role="alert"')
  })

  it('shows the unavailable message with a retry, not an invalid link, when the check fails', async () => {
    const html = await renderEnroll({ step: 'retry', errorKey: 'adminAuth.errors.unavailable' })
    expect(html).toContain('الخدمة غير متاحة الآن')
    expect(html).toContain('إعادة المحاولة')
    expect(html).not.toContain('رابط الدعوة غير صالح')
  })

  it('step 1 asks for the passkey with an optional device name', async () => {
    const html = await renderEnroll({ step: 'passkey' })
    expect(html).toContain('الخطوة 1 من 3')
    expect(html).toContain('الحساب: a@example.test')
    expect(html).toContain('اسم الجهاز')
    expect(html).toContain('إضافة مفتاح المرور')
  })

  it('step 2 shows the setup key and the password form', async () => {
    const html = await renderEnroll({ step: 'totp', totpUri: URI })
    expect(html).toContain('الخطوة 2 من 3')
    expect(html).toContain('JBSW Y3DP EHPK 3PXP')
    expect(html).toContain('autocomplete="new-password"')
    expect(html).toContain('إنهاء التفعيل')
  })

  it('step 2 shows only the preparing text and a retry while the key is missing', async () => {
    const html = await renderEnroll({ step: 'totp', errorKey: 'adminAuth.errors.unavailable' })
    expect(html).toContain('جارٍ تجهيز مفتاح الإعداد')
    expect(html).not.toContain('<form')
  })

  it('step 3 shows the recovery codes once and gates Continue on the checkbox', async () => {
    const html = await renderEnroll({ step: 'recovery', codes: ['abcd-efgh-jkmn', 'pqrs-tuvw-xyz2'] })
    expect(html).toContain('الخطوة 3 من 3')
    expect(html).toContain('abcd-efgh-jkmn')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*متابعة/)
  })

  it('renders English text and never a raw key', async () => {
    const html = await renderEnroll({ step: 'recovery', codes: ['abcd-efgh-jkmn'], lang: 'en' })
    expect(html).toContain('Save your recovery codes')
    expect(html).not.toMatch(/adminAuth\.[a-zA-Z.]+/)
  })
})
