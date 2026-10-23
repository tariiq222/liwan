import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

// The own-custody page: its real <script setup> is evaluated against a real router and its
// real template is rendered from that state.
const filename = resolve(import.meta.dirname, '../self/assets.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor

const ASSET = {
  id: 7, name: 'MacBook Pro', category: { id: 2, name: 'Laptops' }, serial_no: 'SN-77', model: '',
  employee: { id: 4, name: 'Noura' }, assign_date: '2026-05-01', warranty_date: null, scrap_date: null, active: true,
}

type Options = { can?: (capability: string) => boolean; items?: unknown[]; error?: unknown }

async function render(options: Options = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)', component: { template: '<div/>' } }] })
  await router.push('/account/assets?x=1')
  await router.isReady()
  const compiled = compileScript(descriptor, { id: 'assets-mine', inlineTemplate: false }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const js = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const bindings: Record<string, unknown> = {
    definePageMeta: () => {}, useMyHrProfile: () => ({data: Vue.ref({id:4}), isLoading:Vue.ref(false), error:Vue.ref(null)}), _defineComponent: Vue.defineComponent,
    computed: Vue.computed,
    useRoute: () => router.currentRoute.value,
    useI18n: () => ({ t: (key: string) => key }),
    useAccess: () => ({ can: options.can ?? (() => true) }),
    useMyHrAssets: () => ({
      data: Vue.ref(options.error ? undefined : { items: options.items ?? [ASSET], total: (options.items ?? [ASSET]).length }),
      isLoading: Vue.ref(false), error: Vue.ref(options.error ?? null), refetch: () => undefined,
    }),
    returnToQuery: (value: string) => ({ returnTo: value }),
    formatDate: (value: string) => `date:${value}`,
  }
  const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
  const state = component.setup!({}, { expose: () => {}, attrs: {}, slots: {}, emit: () => {} }) as Record<string, any>

  const template = compileTemplate({
    source: descriptor.template!.content, filename, id: 'assets-mine',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (template.errors.length) throw template.errors[0]
  const renderFn = new Function('Vue', ts.transpileModule(template.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText)(Vue) as RenderFunction
  const app = createSSRApp({ render: () => h(defineComponent({ setup: () => ({ ...state }), render: renderFn })) })
  const Passthrough = (name: string) => defineComponent({
    inheritAttrs: false,
    setup(_, { slots, attrs }) { return () => h('div', { 'data-child': name, 'data-title': attrs.title }, [slots.default?.()]) },
  })
  app.component('SharedListPage', Passthrough('page'))
  app.component('SharedListCard', Passthrough('card'))
  app.component('SharedPageState', defineComponent({
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
      return () => attrs.error ? h('div', { 'data-child': 'error' }) : h('div', { 'data-child': 'state' }, [slots.default?.()])
    },
  }))
  app.component('SharedEmptyState', defineComponent({
    inheritAttrs: false,
    setup(_, { attrs }) { return () => h('div', { 'data-child': 'empty', 'data-empty-title': attrs.title }) },
  }))
  app.component('SharedDataTable', defineComponent({
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
      return () => h('div', { 'data-child': 'table', 'data-linked': String(Boolean(attrs['row-to'] ?? attrs.rowTo)) },
        (attrs.rows as typeof ASSET[]).map(row => h('div', { 'data-row': row.id }, [
          slots['name-cell']?.({ row: { original: row } }),
          slots['category-cell']?.({ row: { original: row } }),
          slots['assign_date-cell']?.({ row: { original: row } }),
        ])))
    },
  }))
  return { html: await renderToString(app), state, router }
}

describe('the own-custody page', () => {
  it('lists the holder-safe columns of each asset', async () => {
    const { html } = await render()
    expect(html).toContain('data-title="nav.myAssets"')
    expect(html).toContain('MacBook Pro')
    expect(html).toContain('SN-77')
    expect(html).toContain('Laptops')
    expect(html).toContain('date:2026-05-01')
    expect(html).not.toContain('data-child="empty"')
  })

  it('shows the empty state when the caller holds nothing', async () => {
    const { html } = await render({ items: [] })
    expect(html).toContain('data-empty-title="hrAssets.mine.emptyTitle"')
    expect(html).not.toContain('data-child="table"')
  })

  it('shows the error state when the request fails', async () => {
    const { html } = await render({ error: new Error('boom') })
    expect(html).toContain('data-child="error"')
    expect(html).not.toContain('data-child="table"')
  })

  it('keeps own custody read-only even for an assets administrator', async () => {
    expect((await render({ can: () => true })).html).toContain('data-linked="false"')
    expect((await render({ can: () => false })).html).toContain('data-linked="false"')
  })
})
