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

function mount(failure: unknown) {
  const filename = resolve(import.meta.dirname, '../register.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'register-business-email' }).content).replace('export default', 'return')
  const fetch = vi.fn().mockRejectedValue(failure)
  const bindings = {
    errorCode, errorSeconds, normalizeCode, normalizeMobileInput,
    ForgotPasswordInputSchema: { safeParse: () => ({ success: true }) },
    _defineComponent: Vue.defineComponent, computed: Vue.computed, reactive: Vue.reactive, ref: Vue.ref, watch: Vue.watch, $fetch: fetch,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('ar'), setLocale: () => {} }),
    useResendWait: () => ({ seconds: Vue.ref(0), waiting: Vue.ref(false), start: () => {}, stop: () => {} }),
  }
  const state = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings)).setup({}, { expose: () => {} })
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
  it('has the message in both locales, in plain words', () => {
    for (const locale of [ar, en]) expect(locale.signup.errors.businessEmailRequired.length).toBeGreaterThan(20)
  })
})
