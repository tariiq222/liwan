import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { errorCode } from '../../components/auth/loginFlow'
import ar from '../../../i18n/locales/ar/findWorkspace.json'
import en from '../../../i18n/locales/en/findWorkspace.json'

const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const humanCheck = { human_check: { site_key: 'site-key-fixture', script_url: 'https://widget.example.test/api.js' } }
const filename = resolve(import.meta.dirname, '../find-workspace.vue')
const page = readFileSync(filename, 'utf8')

function mount(fetch: ReturnType<typeof vi.fn>, o: { hydrated?: boolean } = {}) {
  const descriptor = parse(page, { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'find-workspace' }).content).replace('export default', 'return')
  const bindings = {
    errorCode, ForgotPasswordInputSchema: { safeParse: ({ email }: { email: string }) => ({ success: /^[^@\s]+@[^@\s]+$/.test(email) }) },
    _defineComponent: Vue.defineComponent, computed: Vue.computed, onMounted: () => {}, reactive: Vue.reactive, ref: Vue.ref, $fetch: fetch,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(o.hydrated ?? true),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('ar'), setLocale: () => {} }),
  }
  const state = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings)).setup({}, { expose: () => {} })
  const reset = vi.fn()
  state.widget.value = { reset }
  state.config.value = humanCheck
  state.state.email = ' admin@x.test '
  return { state, reset }
}

describe('find-workspace page', () => {
  it('is a public page', () => {
    expect(page).toContain("access: 'public'")
    expect(page).toContain('<AuthTurnstileWidget')
    expect(page.indexOf('<AuthTurnstileWidget')).toBeLessThan(page.indexOf(`:label="t('findWorkspace.submit')"`))
  })
  it('cannot submit before the check completes, or without the widget settings, or before hydration', async () => {
    const fetch = vi.fn()
    const { state } = mount(fetch)
    expect(state.checkReady.value).toBe(false)
    await state.submit()
    expect(fetch).not.toHaveBeenCalled()
    state.humanToken.value = 'tok'
    expect(state.checkReady.value).toBe(true)
    state.config.value = {}
    expect(state.checkReady.value).toBe(false)
    const early = mount(fetch, { hydrated: false })
    early.state.humanToken.value = 'tok'
    await early.state.submit()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sends the trimmed address with the token, shows the same sentence, then spends the token and resets the widget', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    const { state, reset } = mount(fetch)
    state.humanToken.value = 'tok'
    await state.submit()
    expect(fetch).toHaveBeenCalledWith('/api/invitations/find-workspace', { method: 'POST', body: { email: 'admin@x.test', human_token: 'tok' } })
    expect(state.sent.value).toBe(true)
    expect(state.humanToken.value).toBeUndefined()
    expect(reset).toHaveBeenCalledTimes(1)
    // A second request needs a fresh check.
    await state.submit()
    expect(fetch).toHaveBeenCalledTimes(1)
    state.another()
    expect(state.sent.value).toBe(false)
    expect(state.state.email).toBe('')
  })
  it.each([
    ['human_check_failed', 'findWorkspace.errors.humanCheckFailed'],
    ['human_check_unavailable', 'findWorkspace.errors.humanCheckUnavailable'],
    ['rate_limited', 'findWorkspace.errors.rateLimited'],
    ['invalid', 'findWorkspace.errors.invalid'],
    ['anything_else', 'findWorkspace.errors.unavailable'],
  ])('on %s it shows its sentence, never the success one, and asks for the check again', async (code, key) => {
    const fetch = vi.fn().mockRejectedValue({ data: { code } })
    const { state, reset } = mount(fetch)
    state.humanToken.value = 'tok'
    await state.submit()
    expect(state.errorKey.value).toBe(key)
    expect(state.sent.value).toBe(false)
    expect(state.humanToken.value).toBeUndefined()
    expect(reset).toHaveBeenCalled()
  })
  it('words every sentence in both languages with the same keys', () => {
    const keys = (o: unknown, prefix = ''): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])
    expect(keys(ar).sort()).toEqual(keys(en).sort())
    for (const key of Object.values({ ...ar.findWorkspace.errors, sent: ar.findWorkspace.sent })) expect(key).toBeTruthy()
  })
})
