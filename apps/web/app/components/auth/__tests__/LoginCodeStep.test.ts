import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import type { LoginChannels, LoginCodeSent } from '@liwan/contracts'
import { DEFAULT_STUBS, renderShared } from '../../../../../../packages/ui/test/helpers/renderShared'

const component = resolve(import.meta.dirname, '../LoginCodeStep.vue')

const channels: LoginChannels = { channels: ['sms', 'email'], sms_available: true, has_mobile: true, has_email: true }
const sent: LoginCodeSent = { channel: 'email', destination: 's***@example.test', resend_after: 60 }

const passthrough = (tag: string) => Vue.defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) { return () => Vue.h(tag, attrs, slots.default?.()) },
})

/** The Nuxt UI primitives this screen renders; a button keeps its label so the test can read it. */
const stubs = {
  ...DEFAULT_STUBS,
  UButton: Vue.defineComponent({
    inheritAttrs: false,
    props: { label: String, disabled: Boolean },
    setup(props, { attrs }) {
      return () => Vue.h('button', { ...attrs, disabled: props.disabled }, props.label)
    },
  }),
  UForm: passthrough('form'),
  UFormField: passthrough('div'),
  UInput: passthrough('input'),
  UCheckbox: passthrough('span'),
  // The shared channel control is a pill group of buttons; the test reads its items as the choices on offer.
  SharedSegmentedControl: Vue.defineComponent({
    inheritAttrs: false,
    props: { modelValue: String, items: Array, label: String, disabled: Boolean },
    setup(props) {
      return () => Vue.h('div', { role: 'radiogroup', 'aria-label': props.label }, (props.items as { value: string, label: string, testId: string }[])
        .map(item => Vue.h('button', { role: 'radio', 'aria-checked': item.value === props.modelValue, 'data-testid': item.testId }, item.label)))
    },
  }),
}

/** The screen's own helpers, as the real modules behind its two relative imports. */
const flow = { ...(await import('../loginFlow')), ...(await import('../useResendWait')) }

function render(props: Record<string, unknown>) {
  return renderShared(component, props, {}, {
    modules: { './loginFlow': flow, './useResendWait': flow },
    stubs,
    messages: {
      'auth.codeSentToEmail': 'We sent a 6-digit code to your email {destination}',
      'auth.codeSentToSms': 'We sent a 6-digit code to your phone {destination}',
      'auth.resendIn': 'You can resend in {seconds} seconds',
      'auth.resendReady': 'No code yet? Resend it',
    },
    // The template unwraps its own refs, which the shared helper does not preinstall.
    globals: { unref: Vue.unref },
  })
}

describe('the code step', () => {
  it('offers SMS only when the tenant configured a provider, and says why it is missing', async () => {
    const withSms = await render({ channels, channel: 'sms', sent: null, wait: null, pending: false, error: null })
    expect(withSms).toContain('login-channel-sms')
    expect(withSms).toContain('login-channel-email')
    expect(withSms).not.toContain('auth.smsUnavailable')

    const emailOnly = await render({ channels: { ...channels, channels: ['email'], sms_available: false }, channel: 'email', sent: null, wait: null, pending: false, error: null })
    expect(emailOnly).not.toContain('login-channel-sms')
    expect(emailOnly).toContain('login-channel-email')
    expect(emailOnly).toContain('auth.smsUnavailable')
  })

  it('hides SMS for an account with no mobile number', async () => {
    const html = await render({ channels: { ...channels, has_mobile: false }, channel: 'email', sent: null, wait: null, pending: false, error: null })
    expect(html).not.toContain('login-channel-sms')
  })

  it('shows no code field before a code went out, then the server-masked destination and the digit field', async () => {
    const before = await render({ channels, channel: 'email', sent: null, wait: null, pending: false, error: null })
    expect(before).not.toContain('login-code')
    expect(before).toContain('auth.sendCode')

    const after = await render({ channels, channel: 'email', sent, wait: { seconds: 60 }, pending: false, error: null })
    expect(after).toContain('s***@example.test')
    expect(after).toContain('login-code')
    expect(after).toContain('autocomplete="one-time-code"')
    expect(after).toContain('dir="ltr"')
    expect(after).toContain('inputmode="numeric"')
  })

  it('keeps the resend disabled for the whole server wait and announces only that it is ready', async () => {
    const html = await render({ channels, channel: 'email', sent, wait: { seconds: 60 }, pending: false, error: null })
    // The wait comes from the server's `resend_after`, and the button cannot overtake it.
    expect(html).toContain('You can resend in 60 seconds')
    expect(html).toMatch(/<button[^>]*data-testid="login-send"[^>]*disabled/)
    // One polite live region carries both the count and the moment a resend becomes possible.
    expect(html).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*data-testid="login-resend-wait"/)
  })

  it('shows the refusal it was given, never its own wording', async () => {
    const html = await render({ channels, channel: 'email', sent, wait: { seconds: 0 }, pending: false, error: 'رمز التحقق غير صحيح أو انتهت صلاحيته' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('رمز التحقق غير صحيح أو انتهت صلاحيته')
  })

  it('offers one labelled way back to the password step', async () => {
    const html = await render({ channels, channel: 'email', sent: null, wait: null, pending: false, error: null })
    expect(html).toContain('data-testid="login-another"')
    expect(html).toContain('auth.useAnotherAccount')
  })
})
