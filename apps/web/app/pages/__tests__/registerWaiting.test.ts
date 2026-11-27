import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorCode, errorSeconds, normalizeCode } from '../../components/auth/loginFlow'
import { normalizeMobileInput } from '../../composables/useMe'
import { signupOfferTotals } from '../../utils/subscription'
import { suggestWorkspaceSlug, workspaceSlugShapeOk } from '../../utils/workspaceSlug'
import ar from '../../../i18n/locales/ar/signup.json'
import en from '../../../i18n/locales/en/signup.json'

const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const notFound = { data: { code: 'not_found' } }

function mount(fetch: ReturnType<typeof vi.fn>) {
  const filename = resolve(import.meta.dirname, '../register.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'register-waiting' }).content).replace('export default', 'return')
  const mounted: Array<() => unknown> = []
  const bindings = {
    errorCode, errorSeconds, normalizeCode, normalizeMobileInput, signupOfferTotals, suggestWorkspaceSlug, workspaceSlugShapeOk,
    ForgotPasswordInputSchema: { safeParse: () => ({ success: true }) },
    _defineComponent: Vue.defineComponent, computed: Vue.computed, onMounted: (fn: () => unknown) => mounted.push(fn), onBeforeUnmount: () => {},
    reactive: Vue.reactive, ref: Vue.ref, watch: Vue.watch, $fetch: fetch,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true),
    useI18n: () => ({ t: (key: string) => key, te: () => true, locale: Vue.ref('ar'), setLocale: () => {} }),
    useResendWait: () => ({ seconds: Vue.ref(0), waiting: Vue.ref(false), start: () => {}, stop: () => {} }),
  }
  const state = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings)).setup({}, { expose: () => {} })
  return { state, mount: () => mounted[0]!() }
}

/** A fetch that answers status with `status` and every other action with `other`. */
function routes(status: (call: number) => Promise<unknown>, other: () => Promise<unknown> = () => Promise.resolve({})) {
  let calls = 0
  return vi.fn((url: string) => url.endsWith('/status') ? status(calls++) : other())
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('register page, waiting for the workspace', () => {
  it('resumes the waiting screen only when status names a signup', async () => {
    const page = mount(routes(() => Promise.resolve({ state: 'preparing' })))
    vi.useFakeTimers()
    await page.mount()
    expect(page.state.step.value).toBe('preparing')
  })

  it('shows the form when the browser holds no signup, or when the read fails', async () => {
    for (const refusal of [notFound, { data: { code: 'unavailable' } }, new Error('offline')]) {
      const fetch = routes(() => Promise.reject(refusal))
      const page = mount(fetch)
      await page.mount()
      expect(page.state.step.value).toBe('details')
      expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/terms'))).toBe(true)
    }
  })

  it('stops polling after five failures in a row and shows the delayed state', async () => {
    vi.useFakeTimers()
    const fetch = routes(() => Promise.reject({ data: { code: 'unavailable' } }))
    const page = mount(fetch)
    page.state.startPreparing()
    for (let n = 0; n < 6; n++) await vi.advanceTimersByTimeAsync(10_000)
    expect(page.state.preparing.value).toBe('delayed')
    const reads = fetch.mock.calls.filter(([url]) => String(url).endsWith('/status')).length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/status')).length).toBe(reads)
  })

  it('moves the browser on when the workspace is ready with its link', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    const page = mount(routes(() => Promise.resolve({ state: 'ready', handoff_url: 'https://acme.liwan.test/invite/accept#token=t' })))
    page.state.startPreparing()
    await Vue.nextTick(); await Promise.resolve()
    expect(assign).toHaveBeenCalledWith('https://acme.liwan.test/invite/accept#token=t')
  })

  it('says the workspace is ready and offers sign-in when the link was already used', async () => {
    vi.useFakeTimers()
    const fetch = routes(() => Promise.resolve({ state: 'ready' }))
    const page = mount(fetch)
    page.state.startPreparing()
    await vi.advanceTimersByTimeAsync(0)
    expect(page.state.preparing.value).toBe('ready')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/status'))).toHaveLength(1)
    for (const locale of [ar, en]) {
      expect(locale.signup.preparing.readyTitle).toBeTruthy()
      expect(locale.signup.preparing.readyBody.length).toBeGreaterThan(40)
      expect(locale.signup.startOver).toBeTruthy()
    }
  })

  it('starting over clears the cookie and returns to the form', async () => {
    const fetch = routes(() => Promise.reject(notFound))
    const page = mount(fetch)
    page.state.step.value = 'preparing'
    page.state.preparing.value = 'failed'
    await page.state.startNewSignup()
    expect(fetch).toHaveBeenCalledWith('/api/commercial/signup-reset', { method: 'POST' })
    expect(page.state.step.value).toBe('details')
  })
})

describe('register page, address check', () => {
  it('drops a late answer for an address the visitor has already changed', async () => {
    vi.useFakeTimers()
    let answer: (value: unknown) => void = () => {}
    const fetch = vi.fn((url: string) => url.endsWith('/check-slug') ? new Promise(resolve => { answer = resolve }) : Promise.resolve({}))
    const page = mount(fetch)
    page.state.editSlug('acme')
    await Vue.nextTick()
    await vi.advanceTimersByTimeAsync(400)
    page.state.editSlug('acme-two')
    await Vue.nextTick()
    answer({ result: 'available' })
    await vi.advanceTimersByTimeAsync(0)
    expect(page.state.slugState.value).toBe('checking')
  })
})
