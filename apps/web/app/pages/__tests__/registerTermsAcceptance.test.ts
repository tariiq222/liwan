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
const current = { legal_base_url: 'https://legal.example.test', terms_version: '2026-11-01' }
const person = { company_name: 'شركة', admin_name: 'مدير', email: 'owner@company.sa', mobile: '0555555555' }

function mount(fetch: ReturnType<typeof vi.fn>, language = 'ar') {
  const filename = resolve(import.meta.dirname, '../register.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'register-terms' }).content).replace('export default', 'return')
  const mounted: Array<() => unknown> = []
  const bindings = {
    errorCode, errorSeconds, normalizeCode, normalizeMobileInput,
    ForgotPasswordInputSchema: { safeParse: () => ({ success: true }) },
    _defineComponent: Vue.defineComponent, computed: Vue.computed, onMounted: (fn: () => unknown) => mounted.push(fn),
    reactive: Vue.reactive, ref: Vue.ref, watch: Vue.watch, $fetch: fetch,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref(language), setLocale: () => {} }),
    useResendWait: () => ({ seconds: Vue.ref(0), waiting: Vue.ref(false), start: () => {}, stop: () => {} }),
  }
  const state = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings)).setup({}, { expose: () => {} })
  Object.assign(state.details, person)
  return { state, mounted }
}

describe('register page, terms acceptance', () => {
  it('refuses the form until the box is ticked', () => {
    const { state } = mount(vi.fn())
    expect(state.validateDetails({ ...person, accept_terms: false }).map((p: { name: string }) => p.name)).toEqual(['accept_terms'])
    expect(state.validateDetails({ ...person, accept_terms: true })).toEqual([])
  })

  it('loads the current terms on mount and links the legal pages in the visitor language', async () => {
    const fetch = vi.fn().mockResolvedValue(current)
    const arabic = mount(fetch)
    await arabic.mounted[0]!()
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup/terms', { method: 'POST', body: {} })
    expect(arabic.state.termsUrl.value).toBe('https://legal.example.test/terms')
    expect(arabic.state.privacyUrl.value).toBe('https://legal.example.test/privacy')
    const english = mount(fetch, 'en')
    await english.mounted[0]!()
    expect(english.state.termsUrl.value).toBe('https://legal.example.test/en/terms')
    expect(english.state.privacyUrl.value).toBe('https://legal.example.test/en/privacy')
  })

  it('sends the acceptance with the version the page showed, and nothing without it', async () => {
    const fetch = vi.fn().mockResolvedValue({ signup_id: 'id' })
    const { state } = mount(fetch)
    state.legal.value = current
    await state.startSignup()
    expect(fetch).not.toHaveBeenCalled()
    state.details.accept_terms = true
    await state.startSignup()
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup/start', { method: 'POST', body: expect.objectContaining({ accept_terms: true, terms_version: '2026-11-01' }) })
  })

  it('reloads the current terms and asks again when the vendor changed them', async () => {
    const changed = { legal_base_url: 'https://legal.example.test', terms_version: '2026-12-01' }
    const fetch = vi.fn().mockRejectedValueOnce({ data: { code: 'terms_changed' } }).mockResolvedValue(changed)
    const { state } = mount(fetch)
    state.legal.value = current
    state.details.accept_terms = true
    await state.startSignup()
    expect(state.legal.value).toEqual(changed)
    expect(state.details.accept_terms).toBe(false)
    expect(state.errorKey.value).toBe('signup.errors.termsChanged')
  })

  it('words the checkbox and its refusals in both languages', () => {
    for (const locale of [ar, en]) {
      for (const key of ['acceptTerms', 'termsLink', 'privacyLink']) expect(locale.signup[key as 'acceptTerms'], key).toBeTruthy()
      for (const key of ['termsRequired', 'termsChanged']) expect(locale.signup.errors[key as 'termsRequired'], key).toBeTruthy()
      expect(locale.signup.acceptTerms).toContain('{terms}')
      expect(locale.signup.acceptTerms).toContain('{privacy}')
    }
  })
})
