import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { totpQr } from '../../utils/totpQr'
import { renderSfc } from '../../../test/helpers/renderSfc'

describe('PasskeyButton', () => {
  it('shows the label and is live once hydrated', async () => {
    const html = await renderSfc('components/PasskeyButton.vue', { label: 'الدخول بمفتاح المرور' })
    expect(html).toContain('الدخول بمفتاح المرور')
    expect(html).toContain('type="button"')
    expect(html).not.toContain('disabled')
  })

  it('is disabled until the page has hydrated and while a request runs', async () => {
    expect(await renderSfc('components/PasskeyButton.vue', { label: 'x' }, {}, { hydrated: false })).toContain('disabled')
    const html = await renderSfc('components/PasskeyButton.vue', { label: 'x', pending: true })
    expect(html).toContain('disabled')
    expect(html).toContain('data-loading="true"')
  })
})

describe('TotpSetup', () => {
  const uri = 'otpauth://totp/Nasq%3Aa?secret=JBSWY3DPEHPK3PXP&issuer=Nasq'

  it('shows the setup key as left-to-right text and the link to open it', async () => {
    const html = await renderSfc('components/TotpSetup.vue', { uri, secret: 'JBSW Y3DP EHPK 3PXP' })
    expect(html).toContain('JBSW Y3DP EHPK 3PXP')
    expect(html).toMatch(/<code dir="ltr"/)
    expect(html).toContain(`href="${uri.replace('&', '&amp;')}"`)
    expect(html).toContain('فتح في تطبيق المصادقة')
  })

  it('draws the QR code with an accessible label after hydration, next to the key and the link', async () => {
    const html = await renderSfc('components/TotpSetup.vue', { uri, secret: 'JBSW Y3DP EHPK 3PXP' }, {}, {})
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="رمز QR لإضافة الحساب إلى تطبيق المصادقة"/)
    expect(html).toContain('امسح الرمز بتطبيق المصادقة')
    expect(html).toContain(`d="${totpQr(uri).path}"`)
  })

  it('leaves the secret out of server-rendered markup: no QR before hydration', async () => {
    const html = await renderSfc('components/TotpSetup.vue', { uri, secret: 'JBSW Y3DP EHPK 3PXP' }, {}, { hydrated: false })
    expect(html).not.toContain('<svg')
  })

  it('offers no QR or link for anything but an otpauth link', async () => {
    const html = await renderSfc('components/TotpSetup.vue', { uri: 'javascript:alert(1)', secret: null }, {}, {})
    expect(html).not.toContain('<svg')
  })

  it('offers no link for anything but an otpauth link', async () => {
    const html = await renderSfc('components/TotpSetup.vue', { uri: 'javascript:alert(1)', secret: null })
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('فتح في تطبيق المصادقة')
  })

  it('shows the preparing text, and a retry once loading has failed', async () => {
    const loading = await renderSfc('components/TotpSetup.vue', { uri: null, secret: null, loading: true })
    expect(loading).toContain('جارٍ تجهيز مفتاح الإعداد')
    expect(loading).not.toContain('إعادة المحاولة')
    const failed = await renderSfc('components/TotpSetup.vue', { uri: null, secret: null, loading: false })
    expect(failed).toContain('إعادة المحاولة')
  })
})

describe('RecoveryCodes', () => {
  const codes = ['abcd-efgh-jkmn', 'pqrs-tuvw-xyz2']

  it('lists the codes, warns that they are shown once and blocks Continue until they are saved', async () => {
    const html = await renderSfc('components/RecoveryCodes.vue', { codes, modelValue: false })
    for (const code of codes) expect(html).toContain(code)
    expect(html).toContain('لن نستطيع عرضها لك مرة أخرى')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*متابعة/)
  })

  it('enables Continue once the codes are confirmed saved', async () => {
    const html = await renderSfc('components/RecoveryCodes.vue', { codes, modelValue: true })
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>[^<]*متابعة/)
  })
})

describe('StepUpPanel', () => {
  const panel = (state: { pending: boolean, waiting: boolean, error: string | null }, devEnabled = false) =>
    renderSfc('components/StepUpPanel.vue', {}, {}, {
      globals: { useStepUp: () => ({ pending: ref(state.pending), waiting: ref(state.waiting), error: ref(state.error), devEnabled, retry: () => undefined, cancel: () => undefined, confirmWithDev: () => undefined }) },
    })

  it('renders nothing while no step-up is needed', async () => {
    expect(await panel({ pending: false, waiting: false, error: null })).not.toContain('step-up-panel')
  })

  it('asks for the passkey inline, without a dialog, and offers Cancel', async () => {
    const html = await panel({ pending: true, waiting: false, error: null })
    expect(html).toContain('data-slot="step-up-panel"')
    expect(html).toContain('أكّد بمفتاح المرور')
    expect(html).toContain('إلغاء')
    expect(html).not.toContain('إعادة المحاولة')
    expect(html).not.toMatch(/role="(alert)?dialog"/)
  })

  it('offers the developer confirmation only when the development flag is on', async () => {
    expect(await panel({ pending: true, waiting: false, error: null })).not.toContain('تأكيد التطوير')
    expect(await panel({ pending: true, waiting: false, error: null }, true)).toContain('تأكيد التطوير')
  })

  it('shows what failed and offers Retry after a cancelled prompt', async () => {
    const html = await panel({ pending: true, waiting: true, error: 'adminAuth.errors.passkeyCancelled' })
    expect(html).toContain('أُلغي طلب مفتاح المرور')
    expect(html).toContain('إعادة المحاولة')
  })
})
