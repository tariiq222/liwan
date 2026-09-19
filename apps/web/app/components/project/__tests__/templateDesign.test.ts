import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, ref, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

const pages = resolve(dirname(fileURLToPath(import.meta.url)), '../../../pages/project-templates')
const listSource = readFileSync(resolve(pages, 'index.vue'), 'utf8')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

const SharedPageState = defineComponent({
  props: { loading: Boolean, error: { type: [Object, String, Boolean], default: null }, empty: Boolean, emptyText: String },
  setup(props, { slots }) {
    return () => {
      if (props.loading) return h('div', { role: 'status' }, 'loading')
      if (props.error) return h('div', { role: 'alert' }, 'error')
      if (props.empty) return h('div', { role: 'status' }, props.emptyText ?? 'empty')
      return slots.default?.()
    }
  },
})

function loadListPage(setup: () => Record<string, unknown>) {
  const filename = resolve(pages, 'index.vue')
  const parsed = parse(listSource, { filename })
  if (!parsed.descriptor.template) throw new Error('no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: 'template-list',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction
  return defineComponent({ setup, render })
}

async function renderList(setup: () => Record<string, unknown>) {
  const app = createSSRApp({ render: () => h(loadListPage(setup)) })
  app.component('SharedPageContainer', Passthrough)
  app.component('SharedPageHeader', Passthrough)
  app.component('SharedPageState', SharedPageState)
  app.component('FilterBar', Passthrough)
  app.component('Button', Passthrough)
  app.component('Input', Passthrough)
  app.component('NuxtLink', Passthrough)
  app.component('Plus', defineComponent({ setup: () => () => null }))
  app.component('Search', defineComponent({ setup: () => () => null }))
  return renderToString(app)
}

const t = (key: string) => key

function listSetup(overrides: Record<string, unknown> = {}) {
  return () => ({
    t,
    hydrated: true,
    canManage: false,
    canApply: false,
    search: ref(''),
    router: { push: () => {} },
    detailPath: () => '/project-templates/new',
    goPage: () => {},
    pageSize: 50,
    offset: 50,
    total: 0,
    items: [],
    list: {
      isLoading: { value: false },
      error: { value: null },
      isFetching: { value: false },
      refetch: () => {},
    },
    ...overrides,
  })
}

describe('project template catalog pagination', () => {
  it('keeps previous pagination when an offset page returns zero rows', async () => {
    const html = await renderList(listSetup())
    expect(html).toContain('projects.templates.empty')
    expect(html).toContain('projects.templates.pagination.label')
    expect(html).toContain('projects.templates.pagination.previous')
    const emptyAt = html.indexOf('projects.templates.empty')
    const navAt = html.indexOf('projects.templates.pagination.label')
    expect(emptyAt).toBeGreaterThanOrEqual(0)
    expect(navAt).toBeGreaterThan(emptyAt)
  })

  it('hides pagination on the first empty page', async () => {
    const html = await renderList(listSetup({ offset: 0, total: 0, items: [] }))
    expect(html).toContain('projects.templates.empty')
    expect(html).not.toContain('projects.templates.pagination.label')
  })
})
