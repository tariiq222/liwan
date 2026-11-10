import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiProviderPreset } from '@liwan/commercial-contracts'
import * as aiUtils from '../../utils/aiProvider'
import type { Setting } from '../../utils/aiProvider'

// The mounting harness of billingSettingsOnboardingFee.test.ts: the page's script and template are compiled in place, the Nuxt
// bindings it resolves are injected, and the shared components are stubs that record their attributes (the data table renders its cell slots).
const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const scopes: Vue.EffectScope[] = []
afterEach(() => scopes.splice(0).forEach(s => s.stop()))

const openai: AiProviderPreset = { id: 'openai', label: 'OpenAI', provider: 'openai', base_url: 'https://llm-a.example.com/v1', needs_base_url: false, needs_api_key: true, stream_usage: true, stream_usage_editable: false }
const custom: AiProviderPreset = { id: 'custom', label: 'Custom', provider: 'openai_compatible', base_url: null, needs_base_url: true, needs_api_key: true, stream_usage: false, stream_usage_editable: true }

const saved = (): Setting => ({
  revision: 3, margin_bps: 2000, updated_at: '2026-11-06T10:00:00.000Z', updated_by: 'account:7', delivery: 'delivered',
  providers: {
    oai: { preset: 'openai', provider: 'openai', base_url: null, stream_usage: true, key: { configured: true, last4: '6789' } },
    llm: { preset: 'custom', provider: 'openai_compatible', base_url: 'https://llm.example.com/v1', stream_usage: false, key: { configured: true, last4: '1234' } },
  },
  models: {
    mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', cached_input_price: null, output_price: '10', usage_reported: true },
    local: { provider: 'llm', model: 'qwen', input_price: '0.1', cached_input_price: null, output_price: '0.2', usage_reported: false },
  },
  routes: { default: 'mid', balanced: { quick: 'local' } },
})

async function page(options: { saveFails?: unknown, failFirstLoad?: boolean } = {}) {
  const filename = resolve(import.meta.dirname, '../ai-provider.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'ai-provider-mounted' }).content).replace('export default', 'return')
  const api = {
    current: vi.fn(async () => {
      if (options.failFirstLoad && api.current.mock.calls.length === 1) throw { statusCode: 503 }
      return { setting: saved() }
    }),
    presets: vi.fn(async () => ({ items: [openai, custom], total: 2 })),
    models: vi.fn(async () => ({ items: [{ id: 'gpt-4o' }], total: 1 })),
    test: vi.fn(async () => ({ ok: true as const, latency_ms: 12, usage_reported: true })),
    save: vi.fn(async (body: { margin_bps: number }) => {
      if (options.saveFails) throw options.saveFails
      return { setting: { ...saved(), revision: 4, margin_bps: body.margin_bps } }
    }),
  }
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${Object.values(params).join(' ')}` : key)
  const bindings = {
    ...aiUtils, _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, reactive: Vue.reactive,
    formatDateTime: (value: string) => value, definePageMeta: () => {}, useHydrated: () => Vue.ref(true), useI18n: () => ({ t }), useAiProvider: () => api,
    useAsyncData: async (_key: string, fn: () => Promise<unknown>) => {
      const data = Vue.ref<unknown>(null); const error = Vue.ref<unknown>(null); const pending = Vue.ref(false)
      const refresh = vi.fn(async () => { try { data.value = await fn(); error.value = null } catch (cause) { error.value = cause } })
      await refresh()
      return { data, error, pending, refresh }
    },
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope(); scopes.push(scope)
  const state = await scope.run(() => component.setup({}, { expose: () => {} }))
  const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'ai-provider-mounted', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(template.code))(Vue)
  async function rendered() {
    const captured: { name: string, attrs: Record<string, unknown> }[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]!))) {
      app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
        return () => {
          captured.push({ name, attrs: { ...attrs } })
          const head = [attrs.title as string, attrs.description as string, attrs.label as string, attrs.error as string]
          if (name === 'SharedDataTable') {
            const rows = attrs.rows as Array<Record<string, unknown>>
            return Vue.h('div', rows.map(row => Vue.h('div', (attrs.columns as Array<{ id: string }>).map(column => slots[`${column.id}-cell`]?.({ row: { original: row } })))))
          }
          return Vue.h('div', { 'data-testid': attrs['data-testid'] as string | undefined }, [...head, slots.default?.()])
        }
      } }))
    }
    return { html: await renderToString(app), captured }
  }
  const button = async (testid: string, index = 0) => (await rendered()).captured.filter(c => c.attrs['data-testid'] === testid)[index]!.attrs
  return { state, api, rendered, button }
}

describe('AI provider page, mounted', () => {
  it('lists models and tests only for a saved provider, and again only after its endpoint is saved', async () => {
    const p = await page()
    expect((await p.button('ai-model-test', 0)).disabled).toBe(false)   // mid on the saved openai provider
    expect((await p.button('ai-provider-load', 1)).disabled).toBe(false)
    p.state.draft.providers[1].base_url = 'https://other.example.com/v1'  // a stored provider whose endpoint was edited
    expect((await p.button('ai-model-test', 1)).disabled).toBe(true)
    expect((await p.button('ai-provider-load', 1)).disabled).toBe(true)
    expect((await p.rendered()).html).toContain('data-testid="ai-provider-save-first"')
    expect((await p.button('ai-model-test', 0)).disabled).toBe(false)    // the other provider is untouched
    p.state.draft.providers[1].base_url = 'https://llm.example.com/v1/'  // back to the stored one
    expect((await p.button('ai-model-test', 1)).disabled).toBe(false)
  })

  it('disables the actions of a provider and a model that are not saved yet', async () => {
    const p = await page()
    p.state.draft.providers.push({ id: 'fresh', preset: 'openai', base_url: '', api_key: 'sk-12345678', stream_usage: true })
    p.state.draft.models.push({ id: 'new', provider: 'fresh', model: 'gpt', input_price: '', cached_input_price: '', output_price: '' })
    expect((await p.button('ai-model-test', 2)).disabled).toBe(true)
    expect((await p.button('ai-provider-load', 2)).disabled).toBe(true)
    expect((await p.rendered()).html).toContain('data-testid="ai-model-save-first"')
  })

  it('sends a typed key once and holds no key in the form after the save', async () => {
    const p = await page()
    p.state.draft.providers[0].api_key = 'sk-new-secret-123'
    p.state.reason.value = 'Rotate the key'
    await p.state.save()
    expect(p.api.save).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(p.api.save.mock.calls[0])).toContain('sk-new-secret-123')
    expect(p.state.draft.providers.map((x: { api_key: string }) => x.api_key)).toEqual(['', ''])
    expect((await p.rendered()).html).not.toContain('sk-new-secret-123')
    expect(p.state.notice.value).toContain('aiProvider.save.saved')
  })

  it('shows the effective model of a route cell that inherits', async () => {
    const p = await page()
    expect(p.state.inheritedName('economical', 'quick')).toBe(aiUtils.ltr('local'))     // through the balanced column
    expect(p.state.inheritedName('best', 'analysis')).toBe(aiUtils.ltr('mid'))           // through the default
    expect((await p.rendered()).html).toContain(`aiProvider.routes.inheritsFrom ${aiUtils.ltr('local')}`)
    p.state.draft.routes.default = ''
    expect(p.state.inheritedName('best', 'analysis')).toBe('aiProvider.routes.none')
  })

  it.each([
    ['model_not_tested', 'ai-provider-routes-error', 'aiProvider.errors.model_not_tested'],
    ['default_required', 'ai-provider-routes-error', 'aiProvider.errors.default_required'],
    ['unknown_provider', 'ai-provider-models-error', 'aiProvider.errors.unknown_provider'],
    ['api_key_required', 'ai-provider-providers-error', 'aiProvider.errors.api_key_required'],
  ])('puts the server code %s in its own section only', async (code, testid, message) => {
    const p = await page({ saveFails: { data: { code } } })
    p.state.reason.value = 'A change'
    await p.state.save()
    const { html } = await p.rendered()
    for (const other of ['ai-provider-routes-error', 'ai-provider-models-error', 'ai-provider-providers-error', 'ai-provider-error']) {
      if (other === testid) expect(html).toContain(`data-testid="${other}"`)
      else expect(html).not.toContain(`data-testid="${other}"`)
    }
    expect(html).toContain(message)
  })

  it('shows an error that belongs to no section at the top of the page', async () => {
    const p = await page({ saveFails: { data: { code: 'provider_file_unavailable' } } })
    p.state.reason.value = 'A change'
    await p.state.save()
    expect((await p.rendered()).html).toContain('data-testid="ai-provider-error"')
  })

  it('fills the form when a retry succeeds after the first load failed', async () => {
    const p = await page({ failFirstLoad: true })
    expect(p.state.draft.providers).toEqual([])
    await p.state.refresh()
    expect(p.state.draft.providers.map((x: { id: string }) => x.id)).toEqual(['oai', 'llm'])
    expect(p.state.draft.models.map((x: { id: string }) => x.id)).toEqual(['mid', 'local'])
    expect(p.state.draft.margin_percent).toBe('20')
    expect(p.state.draft.routes.default).toBe('mid')
    expect(p.state.draft.routes.cells['balanced.quick']).toBe('local')
  })

  it('keeps unsaved edits when the setting is refetched after a test', async () => {
    const p = await page()
    p.state.draft.margin_percent = '35'
    p.state.draft.models[0].model = 'edited'
    await p.state.testModel(p.state.draft.models[1])
    expect(p.api.test).toHaveBeenCalledTimes(1)
    expect(p.api.current).toHaveBeenCalledTimes(2)  // the refetch happened
    expect(p.state.draft.margin_percent).toBe('35')
    expect(p.state.draft.models[0].model).toBe('edited')
  })

  it('warns, naming the model, when a routed model has no price', async () => {
    const p = await page()
    expect((await p.rendered()).html).not.toContain('ai-provider-unpriced-warning')
    p.state.draft.models[0].output_price = ''
    const html = (await p.rendered()).html
    expect(html).toContain('ai-provider-unpriced-warning')
    expect(html).toContain(aiUtils.ltr('mid'))
  })
})
