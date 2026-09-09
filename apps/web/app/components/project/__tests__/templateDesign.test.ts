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
const detail = readFileSync(resolve(pages, '[id].vue'), 'utf8')
const create = readFileSync(resolve(pages, 'new.vue'), 'utf8')
const edit = readFileSync(resolve(pages, '[id]/edit.vue'), 'utf8')
const apply = readFileSync(resolve(pages, '[id]/apply.vue'), 'utf8')

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

describe('project template page design', () => {
  it('uses SharedPageState for catalog loading, retryable errors and empty instead of ad-hoc copy', () => {
    expect(listSource).toContain('SharedPageState')
    expect(listSource).toContain('@retry="list.refetch"')
    expect(listSource).toContain("t('projects.templates.empty')")
    expect(listSource).toContain(':active-count="activeFilterCount"')
    expect(listSource).toContain('name="template-search"')
    expect(listSource).toContain('refDebounced')
    expect(listSource).toContain('useHydrated')
    expect(listSource).toContain('can_manage')
    expect(listSource).toContain('can_apply')
    expect(listSource).toContain('returnTo')
    expect(listSource).toContain('offset')
    expect(listSource).toContain('grid gap-3 md:grid-cols-2')
    expect(listSource).not.toContain('nasq-empty-state')
    expect(listSource).not.toContain("t('projects.loading')")
    expect(listSource).not.toMatch(/LayoutGrid|tableView|onViewChange/)
  })

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

  it('keeps create, edit, apply and detail on internal routes with returnTo and data guards', () => {
    for (const source of [detail, create, edit, apply]) {
      expect(source).toContain('SharedPageState')
      expect(source).toContain('@retry')
      expect(source).toContain('returnTo')
    }
    expect(create).toContain('can_manage')
    expect(edit).toContain('can_manage')
    expect(apply).toContain('can_apply')
    expect(apply).toContain('SharedUnsavedChanges')
    expect(apply).toContain('ProjectTemplateApplySchema')
    expect(detail).toContain('confirmDelete')
    expect(detail).toContain('templatePath(template.id, \'apply\')')
    expect(detail).toContain('templatePath(template.id, \'edit\')')
    expect(edit).toContain('template ? null : error')
    expect(apply).toContain('template ? null : error')
    expect(create).toContain('permissions.data.value ? null : permissions.error.value')
  })
})
