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

// The page's script is compiled in place with its Nuxt bindings injected, as the other page suites do.
const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
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

function mount(failure: unknown, answer?: unknown) {
  const filename = resolve(import.meta.dirname, '../register.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'register-business-email' }).content).replace('export default', 'return')
  const fetch = answer === undefined ? vi.fn().mockRejectedValue(failure) : vi.fn().mockResolvedValue(answer)
  const bindings = {
    errorCode, errorSeconds, normalizeCode, normalizeMobileInput, signupOfferTotals, suggestWorkspaceSlug, workspaceSlugShapeOk, onBeforeUnmount: () => {},
    ForgotPasswordInputSchema: { safeParse: () => ({ success: true }) },
    _defineComponent: Vue.defineComponent, computed: Vue.computed, onMounted: () => {}, reactive: Vue.reactive, ref: Vue.ref, watch: Vue.watch, $fetch: fetch,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true),
    useI18n: () => ({ t: (key: string) => key, te: () => true, locale: Vue.ref('ar'), setLocale: () => {} }),
    useResendWait: () => ({ seconds: Vue.ref(0), waiting: Vue.ref(false), start: () => {}, stop: () => {} }),
  }
  const state = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings)).setup({}, { expose: () => {} })
  state.legal.value = { legal_base_url: 'https://legal.example.test', terms_version: '2026-11-01' }
  state.humanToken.value = 'tok'
  state.details.accept_terms = true
  state.offer.value = offerFixture
  state.selectedApps.value = ['crm']
  return state
}

describe('register page, free-mail refusal', () => {
  it('shows the server refusal on the email field and clears it when the email changes', async () => {
    const state = mount({ data: { code: 'business_email_required' } })
    state.details.email = 'owner@gmail.com'
    await state.submitDetails()
    expect(state.emailErrorKey.value).toBe('signup.errors.businessEmailRequired')
    expect(state.errorKey.value).toBeUndefined()
    state.details.email = 'owner@company.sa'
    await Vue.nextTick()
    expect(state.emailErrorKey.value).toBeUndefined()
  })
  it('keeps the general alert for other refusals', async () => {
    const state = mount({ data: { code: 'rate_limited' } })
    await state.submitDetails()
    expect(state.errorKey.value).toBe('signup.errors.rateLimited')
    expect(state.emailErrorKey.value).toBeUndefined()
  })
  it('says the company already used its trial when the server refuses the claim, in both locales', async () => {
    const state = mount({ data: { code: 'trial_already_used' } })
    await state.submitDetails()
    expect(state.errorKey.value).toBe('signup.errors.trialAlreadyUsed')
    expect(state.emailErrorKey.value).toBeUndefined()
    for (const locale of [ar, en]) {
      expect(locale.signup.errors.trialAlreadyUsed.length).toBeGreaterThan(80)
      expect(locale.signup.errors.trialAlreadyUsed).not.toContain('{')
    }
  })
  it('has the message in both locales, in plain words', () => {
    for (const locale of [ar, en]) expect(locale.signup.errors.businessEmailRequired.length).toBeGreaterThan(20)
  })
  it('verifies each channel on its own and completes only when both are confirmed', async () => {
    const state = mount(null, { ok: true })
    state.signupId.value = 'signup-1'
    state.step.value = 'verify'
    state.details.slug = 'acme'
    await state.complete()
    expect(state.step.value).toBe('verify')
    state.codes.email = '654321'
    await state.verifyCode('email')
    expect(state.verified.email).toBe(true)
    expect(state.verified.sms).toBe(false)
    state.codes.sms = '123456'
    await state.verifyCode('sms')
    expect(state.verified.sms).toBe(true)
    await state.complete()
    expect(state.step.value).toBe('preparing')
  })
  it('keeps both confirmations and returns to the address when someone took it first', async () => {
    const state = mount({ data: { code: 'slug_taken' } })
    state.signupId.value = 'signup-1'
    state.step.value = 'verify'
    state.verified.sms = true
    state.verified.email = true
    await state.complete()
    expect(state.step.value).toBe('details')
    expect(state.slugState.value).toBe('unavailable')
    expect(state.errorKey.value).toBe('signup.errors.slugTaken')
    expect(state.verified.sms && state.verified.email).toBe(true)
    for (const locale of [ar, en]) expect(locale.signup.errors.slugTaken.length).toBeGreaterThan(20)
  })
  it('suggests an address from the company name until the visitor types their own', async () => {
    const state = mount(null, { result: 'available' })
    state.details.company_name = 'Acme Trading'
    await Vue.nextTick()
    expect(state.details.slug).toBe('acme-trading')
    state.editSlug('acme-sa')
    state.details.company_name = 'Other Name'
    await Vue.nextTick()
    expect(state.details.slug).toBe('acme-sa')
  })
  it('says the trial starts at first sign-in, without numbers', () => {
    const page = readFileSync(resolve(import.meta.dirname, '../register.vue'), 'utf8')
    expect(page).toContain("t('signup.trialStarts')")
    for (const locale of [ar, en]) {
      expect(locale.signup.trialStarts.length).toBeGreaterThan(20)
      expect(locale.signup.trialStarts).not.toMatch(/\d/)
    }
  })
})
