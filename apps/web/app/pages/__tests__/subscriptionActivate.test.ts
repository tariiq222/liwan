import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as accessPolicy from '../../utils/accessPolicy'
import { SETUP_PATH, canUseSetup } from '../../composables/setup/setupSteps'

// The activation page's own script runs here with a mocked API and the Nuxt auto-imports stood in for, and its template is
// rendered with plain stand-ins for the components. This tests the page's state machine, not the source text.
const filename = resolve(import.meta.dirname, '../subscription/activate.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (source: string) => source.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const script = stripImports(compileScript(descriptor, { id: 'subscription-activate' }).content).replace('export default', 'return')
const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'subscription-activate', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
const render = new Function('Vue', transpile(template.code))(Vue)

const identity = { id: 42 }
const scopes: Vue.EffectScope[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.useRealTimers() })

async function mountPage(activation: () => Promise<{ state: string; trial_ends_at?: string }>, polled: () => Promise<{ state: string; trial_ends_at?: string }> = activation) {
  const api = { activateTrial: vi.fn(activation), trialActivation: vi.fn(polled) }
  const checked = Vue.ref<number | null>(null)
  const router = { replace: vi.fn(async () => {}) }
  const mounted: Array<() => void> = []
  const bindings = {
    ...accessPolicy, SETUP_PATH, canUseSetup, _defineComponent: Vue.defineComponent,
    ref: Vue.ref, onMounted: (fn: () => void) => mounted.push(fn), onBeforeUnmount: () => {},
    definePageMeta: () => {}, useState: () => checked, useRouter: () => router,
    formatDateTime: (iso: string) => `on:${iso}`,
    useI18n: () => ({ t: (key: string, params?: { date?: string }) => params?.date ? `${key} ${params.date}` : key }),
    useSubscriptionApi: () => api,
    useMe: () => ({ me: Vue.ref(identity), refresh: vi.fn(async () => {}) }),
    useCustomerCapabilities: () => ({ can: () => true }),
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope(); scopes.push(scope)
  const state = scope.run(() => component.setup({}, { expose: () => {} }))
  mounted.forEach(fn => fn())
  await vi.advanceTimersByTimeAsync(0)
  async function html() {
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) {
      app.component(name, Vue.defineComponent({
        name, inheritAttrs: false,
        setup(_, { attrs, slots }) {
          return () => Vue.h('div', { 'data-component': name }, [[attrs.title, attrs.label].filter(Boolean).join(' '), slots.default?.(), slots.header?.()])
        },
      }))
    }
    return renderToString(app)
  }
  return { state, router, checked, api, html }
}

describe('the trial activation page', () => {
  it('a failed fulfillment says the trial started, offers no retry and sends no second activation', async () => {
    const end = '2026-12-03T09:00:00.000Z'
    const page = await mountPage(async () => ({ state: 'failed', trial_ends_at: end }))
    const html = await page.html()
    expect(html).toContain(`subscription.activation.delayed on:${end}`)
    expect(html).toContain('subscription.activation.continue')
    expect(html).not.toContain('subscription.activation.retry')
    await vi.advanceTimersByTimeAsync(3000)
    expect(page.api.activateTrial).toHaveBeenCalledOnce()
    expect(page.api.trialActivation).toHaveBeenCalledOnce()
  })
  it('a failed fulfillment that later becomes ready navigates on its own', async () => {
    const page = await mountPage(async () => ({ state: 'failed', trial_ends_at: '2026-12-03T09:00:00.000Z' }), async () => ({ state: 'ready' }))
    expect(page.router.replace).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(page.checked.value).toBe(42)
    expect(page.router.replace).toHaveBeenCalledOnce()
    expect(page.api.activateTrial).toHaveBeenCalledOnce()
  })
  it('a failed request shows the retry and continue actions', async () => {
    const page = await mountPage(async () => { throw Object.assign(new Error('tenant_upgrade_required'), { statusCode: 409 }) })
    const html = await page.html()
    expect(html).toContain('subscription.activation.failed')
    expect(html).toContain('subscription.activation.retry'); expect(html).toContain('subscription.activation.continue')
  })
  it('continuing sets the checked state to the user id and replaces the route with the home page', async () => {
    const page = await mountPage(async () => ({ state: 'waiting' }))
    expect(page.checked.value).toBeNull()
    await page.state.continueWithoutTrial()
    expect(page.checked.value).toBe(42)
    expect(page.router.replace).toHaveBeenCalledWith('/')
  })
  it('a waiting state shows no actions and does not release the user', async () => {
    const page = await mountPage(async () => ({ state: 'waiting' }))
    const html = await page.html()
    expect(html).not.toContain('subscription.activation.continue')
    expect(page.checked.value).toBeNull()
    expect(page.router.replace).not.toHaveBeenCalled()
  })
  it('a ready state marks the user checked and navigates on its own', async () => {
    const page = await mountPage(async () => ({ state: 'ready' }))
    expect(page.checked.value).toBe(42)
    expect(page.router.replace).toHaveBeenCalledOnce()
  })
})
