import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { errorCode, errorSeconds, normalizeCode } from '../../components/auth/loginFlow'
import { normalizeMobileInput } from '../../composables/useMe'
import ar from '../../../i18n/locales/ar/signup.json'
import en from '../../../i18n/locales/en/signup.json'

const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const config = { legal_base_url: 'https://legal.example.test', terms_version: '2026-11-01', human_check: { site_key: 'site-key-fixture', script_url: 'https://widget.example.test/api.js' } }
const page = readFileSync(resolve(import.meta.dirname, '../register.vue'), 'utf8')

function mount(fetch: ReturnType<typeof vi.fn>) {
  const filename = resolve(import.meta.dirname, '../register.vue')
  const descriptor = parse(page, { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'register-human' }).content).replace('export default', 'return')
  const bindings = {
    errorCode, errorSeconds, normalizeCode, normalizeMobileInput,
    ForgotPasswordInputSchema: { safeParse: () => ({ success: true }) },
    _defineComponent: Vue.defineComponent, computed: Vue.computed, onMounted: () => {}, reactive: Vue.reactive, ref: Vue.ref, watch: Vue.watch, $fetch: fetch,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('ar'), setLocale: () => {} }),
    useResendWait: () => ({ seconds: Vue.ref(0), waiting: Vue.ref(false), start: () => {}, stop: () => {} }),
  }
  const state = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings)).setup({}, { expose: () => {} })
  const reset = vi.fn()
  state.widget.value = { reset }
  state.legal.value = config
  state.details.accept_terms = true
  return { state, reset }
}

describe('register page, bot check', () => {
  it('cannot submit before the check completes', async () => {
    const fetch = vi.fn()
    const { state } = mount(fetch)
    expect(state.checkReady.value).toBe(false)
    await state.startSignup()
    expect(fetch).not.toHaveBeenCalled()
    state.humanToken.value = 'tok'
    expect(state.checkReady.value).toBe(true)
  })

  it('cannot submit when the server sent no widget settings', () => {
    const { state } = mount(vi.fn())
    state.legal.value = { legal_base_url: config.legal_base_url, terms_version: config.terms_version }
    state.humanToken.value = 'tok'
    expect(state.checkReady.value).toBe(false)
  })

  it('sends the token with start, then spends it and resets the widget', async () => {
    const fetch = vi.fn().mockResolvedValue({ signup_id: 'id' })
    const { state, reset } = mount(fetch)
    state.humanToken.value = 'tok'
    await state.startSignup()
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup/start', { method: 'POST', body: expect.objectContaining({ human_token: 'tok' }) })
    expect(state.humanToken.value).toBeUndefined()
    expect(reset).toHaveBeenCalledTimes(1)
    // A second start (the resend) needs a fresh check.
    await state.startSignup()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('resets the widget and asks for the check again when the server refuses the token', async () => {
    const fetch = vi.fn().mockRejectedValue({ data: { code: 'human_check_failed' } })
    const { state, reset } = mount(fetch)
    state.humanToken.value = 'tok'
    await state.startSignup()
    expect(state.errorKey.value).toBe('signup.errors.humanCheckFailed')
    expect(state.humanToken.value).toBeUndefined()
    expect(reset).toHaveBeenCalled()
  })

  it('says honestly that the check service is unreachable', async () => {
    const fetch = vi.fn().mockRejectedValue({ data: { code: 'human_check_unavailable' } })
    const { state, reset } = mount(fetch)
    state.humanToken.value = 'tok'
    await state.startSignup()
    expect(state.errorKey.value).toBe('signup.errors.humanCheckUnavailable')
    expect(reset).toHaveBeenCalled()
  })

  it('does not ask for a token on the email code', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    const { state } = mount(fetch)
    state.signupId.value = 'id'
    await state.sendEmail()
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup/send-email', { method: 'POST', body: { signup_id: 'id' } })
  })

  it('words the check and its refusals in both languages and shows the widget before the buttons that send', () => {
    for (const locale of [ar, en]) {
      expect(locale.signup.humanCheck).toBeTruthy()
      expect(locale.signup.errors.humanCheckFailed).toBeTruthy()
      expect(locale.signup.errors.humanCheckUnavailable).toBeTruthy()
    }
    expect(page.indexOf('<AuthTurnstileWidget')).toBeLessThan(page.indexOf(`:label="t('signup.sendSms')"`))
    expect(page).toMatch(/step === 'sms' && humanCheck/)
  })
})
