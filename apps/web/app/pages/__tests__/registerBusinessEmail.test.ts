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

// The page's script is compiled in place with its Nuxt bindings injected, as the other page suites do.
const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')

function mount(failure: unknown, answer?: unknown) {
  const filename = resolve(import.meta.dirname, '../register.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'register-business-email' }).content).replace('export default', 'return')
  const fetch = answer === undefined ? vi.fn().mockRejectedValue(failure) : vi.fn().mockResolvedValue(answer)
  const bindings = {
    errorCode, errorSeconds, normalizeCode, normalizeMobileInput,
    ForgotPasswordInputSchema: { safeParse: () => ({ success: true }) },
    _defineComponent: Vue.defineComponent, computed: Vue.computed, onMounted: () => {}, reactive: Vue.reactive, ref: Vue.ref, watch: Vue.watch, $fetch: fetch,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('ar'), setLocale: () => {} }),
    useResendWait: () => ({ seconds: Vue.ref(0), waiting: Vue.ref(false), start: () => {}, stop: () => {} }),
  }
  const state = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings)).setup({}, { expose: () => {} })
  state.legal.value = { legal_base_url: 'https://legal.example.test', terms_version: '2026-11-01' }
  state.humanToken.value = 'tok'
  state.details.accept_terms = true
  state.offer.value = { offer_revision: 'test-revision' }
  return state
}

describe('register page, free-mail refusal', () => {
  it('shows the server refusal on the email field and clears it when the email changes', async () => {
    const state = mount({ data: { code: 'business_email_required' } })
    state.details.email = 'owner@gmail.com'
    await state.startSignup()
    expect(state.emailErrorKey.value).toBe('signup.errors.businessEmailRequired')
    expect(state.errorKey.value).toBeUndefined()
    state.details.email = 'owner@company.sa'
    await Vue.nextTick()
    expect(state.emailErrorKey.value).toBeUndefined()
  })
  it('keeps the general alert for other refusals', async () => {
    const state = mount({ data: { code: 'rate_limited' } })
    await state.startSignup()
    expect(state.errorKey.value).toBe('signup.errors.rateLimited')
    expect(state.emailErrorKey.value).toBeUndefined()
  })
  it('says the company already used its trial when the server refuses the claim, in both locales', async () => {
    const state = mount({ data: { code: 'trial_already_used' } })
    await state.startSignup()
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
  it('the done step names the address, promises minutes, and says what to do when the invitation is late', () => {
    for (const locale of [ar, en]) {
      expect(locale.signup.invitation).toContain('{email}')
      expect(locale.signup.invitationLate.length).toBeGreaterThan(60)
    }
    const page = readFileSync(resolve(import.meta.dirname, '../register.vue'), 'utf8')
    expect(page).toContain("t('signup.invitation', { email: verifiedEmail })")
    expect(page).toContain("t('signup.invitationLate')")
  })
  it('after a successful email verification the done step keeps the verified address and clears the form', async () => {
    const state = mount(null, { ok: true })
    state.details.email = '  owner@company.sa '
    state.signupId.value = 'signup-1'
    state.step.value = 'email'
    state.verification.code = '123456'
    await state.verifyCode()
    expect(state.step.value).toBe('done')
    expect(state.verifiedEmail.value).toBe('owner@company.sa')
    expect(state.details.email).toBe('')
    for (const locale of [ar, en]) expect(locale.signup.invitation.replace('{email}', state.verifiedEmail.value)).toContain('owner@company.sa')
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
