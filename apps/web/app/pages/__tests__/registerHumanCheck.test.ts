import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { errorCode, errorSeconds, normalizeCode } from '../../components/auth/loginFlow'
import { normalizeMobileInput } from '../../composables/useMe'
import { signupOfferTotals, type SignupOffer } from '../../utils/subscription'
import { suggestWorkspaceSlug, workspaceSlugShapeOk } from '../../utils/workspaceSlug'
import ar from '../../../i18n/locales/ar/signup.json'
import en from '../../../i18n/locales/en/signup.json'

const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const config = { legal_base_url: 'https://legal.example.test', terms_version: '2026-11-01', human_check: { site_key: 'site-key-fixture', script_url: 'https://widget.example.test/api.js' } }
const page = readFileSync(resolve(import.meta.dirname, '../register.vue'), 'utf8')
const offerFixture: SignupOffer = {
  offer_revision: 'test-revision',
  plan_name: 'Starter',
  trial_days: 14,
  currency: 'SAR',
  currency_exponent: 2,
  base_monthly_minor: 0,
  tax: { kind: 'none' },
  included_users: 3,
  included_storage_mb: 20480,
  included_extra_branches: 1,
  included_apps: [],
  apps: [{ id: 'crm', name_ar: 'إدارة العملاء', name_en: 'CRM', monthly_minor: 9900, limits: {} }],
}

function mount(fetch: ReturnType<typeof vi.fn>) {
  const filename = resolve(import.meta.dirname, '../register.vue')
  const descriptor = parse(page, { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'register-human' }).content).replace('export default', 'return')
  const bindings = {
    errorCode, errorSeconds, normalizeCode, normalizeMobileInput, signupOfferTotals, suggestWorkspaceSlug, workspaceSlugShapeOk, onBeforeUnmount: () => {},
    ForgotPasswordInputSchema: { safeParse: () => ({ success: true }) },
    _defineComponent: Vue.defineComponent, computed: Vue.computed, onMounted: () => {}, reactive: Vue.reactive, ref: Vue.ref, watch: Vue.watch, $fetch: fetch,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true),
    useI18n: () => ({ t: (key: string) => key, te: () => true, locale: Vue.ref('ar'), setLocale: () => {} }),
    useResendWait: () => ({ seconds: Vue.ref(0), waiting: Vue.ref(false), start: () => {}, stop: () => {} }),
  }
  const state = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings)).setup({}, { expose: () => {} })
  const reset = vi.fn()
  state.widget.value = { reset }
  state.legal.value = config
  state.details.accept_terms = true
  state.offer.value = offerFixture
  state.selectedApps.value = ['crm']
  return { state, reset }
}

describe('register page, bot check', () => {
  it('cannot submit before the check completes', async () => {
    const fetch = vi.fn()
    const { state } = mount(fetch)
    expect(state.checkReady.value).toBe(false)
    await state.submitDetails()
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
    await state.submitDetails()
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup/start', { method: 'POST', body: expect.objectContaining({ human_token: 'tok' }) })
    expect(state.humanToken.value).toBeUndefined()
    expect(reset).toHaveBeenCalledTimes(1)
    // Starting again from the details step needs a fresh check.
    state.step.value = 'details'
    state.signupId.value = undefined
    await state.submitDetails()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('resets the widget and asks for the check again when the server refuses the token', async () => {
    const fetch = vi.fn().mockRejectedValue({ data: { code: 'human_check_failed' } })
    const { state, reset } = mount(fetch)
    state.humanToken.value = 'tok'
    await state.submitDetails()
    expect(state.errorKey.value).toBe('signup.errors.humanCheckFailed')
    expect(state.humanToken.value).toBeUndefined()
    expect(reset).toHaveBeenCalled()
  })

  it('says honestly that the check service is unreachable', async () => {
    const fetch = vi.fn().mockRejectedValue({ data: { code: 'human_check_unavailable' } })
    const { state, reset } = mount(fetch)
    state.humanToken.value = 'tok'
    await state.submitDetails()
    expect(state.errorKey.value).toBe('signup.errors.humanCheckUnavailable')
    expect(reset).toHaveBeenCalled()
  })

  it('resends one channel at a time without asking for a token', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    const { state } = mount(fetch)
    state.signupId.value = 'id'
    await state.resendCode('email')
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup/resend', { method: 'POST', body: { signup_id: 'id', channel: 'email' } })
    await state.resendCode('sms')
    expect(fetch).toHaveBeenLastCalledWith('/api/commercial/signup/resend', { method: 'POST', body: { signup_id: 'id', channel: 'sms' } })
  })

  it('words the check and its refusals in both languages and shows the widget before the buttons that send', () => {
    for (const locale of [ar, en]) {
      expect(locale.signup.humanCheck).toBeTruthy()
      expect(locale.signup.errors.humanCheckFailed).toBeTruthy()
      expect(locale.signup.errors.humanCheckUnavailable).toBeTruthy()
    }
    expect(page.indexOf('<AuthTurnstileWidget')).toBeLessThan(page.indexOf(`:label="t('signup.offer.begin')"`))
    expect(page).not.toContain("step === 'sms'")
  })
})
