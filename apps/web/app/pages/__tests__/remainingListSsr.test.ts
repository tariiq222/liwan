import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import { formatDateTime } from '../../../../../packages/ui/app/utils/formatDate'

type State = 'rows' | 'empty' | 'error' | 'forbidden'
const appRoot = resolve(import.meta.dirname, '../..')
function templateComponent(path: string, bindings: Record<string, unknown>) {
  const filename = resolve(appRoot, path)
  const template = parse(readFileSync(filename, 'utf8')).descriptor.template!.content
  const compiled = compileTemplate({ source: template, filename, id: path, compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(Vue)
  return Vue.defineComponent({ setup: () => bindings, render })
}
const shell = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', [slots.filters?.(), slots.search?.(), slots.default?.({ view: 'table' }), slots.footer?.()]) })
const control = Vue.defineComponent({ setup: (_, { attrs, slots }) => () => Vue.h('button', { disabled: attrs.disabled }, [slots.default?.(), slots.trailing?.()]) })
const row = { id: 7, name: 'Server row', file_name: 'Server import.csv', steps: [], state: 'active', assignees: [], created_at: '2026-11-06T00:30:00Z', created: 2, duplicate: 0, invalid: 0, unassigned: 0 }
const dataTable = Vue.defineComponent({ props: ['rows', 'error', 'emptyText'], setup: (props, { slots }) => () => props.error
  ? Vue.h('p', { 'data-state': 'error' }, 'Server failure')
  : !(props.rows as unknown[]).length ? Vue.h('p', { 'data-state': 'empty' }, String(props.emptyText || 'Empty'))
    : Vue.h('div', [Vue.h('table', (props.rows as typeof row[]).map(item => Vue.h('tr', [
        Vue.h('td', item.name || item.file_name),
        ...Object.entries(slots).filter(([name]) => name.endsWith('-cell')).map(([, slot]) => Vue.h('td', slot?.({ row: { original: item } }))),
      ]))), slots.footer?.()]) })
async function render(component: Vue.Component) {
  const app = Vue.createSSRApp(component)
  for (const name of ['SharedListPage', 'SharedSettingsPage', 'SharedPageHeader', 'SharedListCard', 'SharedFilterBar', 'FilterBar', 'NuxtLink', 'RecordNumber', 'SharedRecordNumber', 'TaskDescriptionHint', 'StateMenu', 'PrioritySelect', 'SharedPersonAvatar', 'SharedStatusBadge', 'SharedInlineConfirm', 'UAlert', 'TaskArchivedList', 'TaskBoard', 'SharedProgress', 'ProjectProgress', 'ProjectMenu', 'ProjectCardBody']) app.component(name, shell)
  for (const name of ['UInput', 'USelect', 'UButton']) app.component(name, control)
  for (const name of ['SharedForbiddenState', 'SharedEmptyState', 'SharedLoadingSkeleton']) app.component(name, Vue.defineComponent({ setup: (_, { attrs }) => () => Vue.h('p', { 'data-state': name }, String(attrs.title || name)) }))
  app.component('SharedPageState', Vue.defineComponent({ props: ['error'], setup: (props, { slots }) => () => props.error ? Vue.h('p', { 'data-state': 'SharedPageState' }, 'Server failure') : slots.default?.() }))
  app.component('SharedListFooter', Vue.defineComponent({ setup: (_, { attrs }) => () => Vue.h('button', { 'data-testid': 'ssr-pager', disabled: attrs.disabled }) }))
  app.component('SharedDataTable', dataTable)
  app.component('TaskTable', Vue.defineComponent({ setup: () => () => Vue.h('table', 'Server task') }))
  app.component('TaskToolbar', Vue.defineComponent({ setup: () => () => Vue.h('input', { disabled: true }) }))
  for (const name of ['TaskKpiStrip', 'ProjectKpiStrip']) app.component(name, Vue.defineComponent({ setup: () => () => Vue.h('p', 'Unexpected KPI request') }))
  for (const name of ['NuxtPage', 'SharedSegmentedControl', 'SharedRowActions']) app.component(name, shell)
  for (const name of ['ProjectCards', 'ProjectTable']) app.component(name, Vue.defineComponent({ props: ['items'], setup: props => () => Vue.h('table', (props.items as typeof row[]).map(item => Vue.h('tr', item.name))) }))
  return renderToString(app)
}
function bindings(state: State, hydrated = false) {
  const items = state === 'rows' ? [row] : []
  const query = { error: Vue.ref(state === 'error' ? new Error('Failure') : null), isLoading: Vue.ref(false), isPending: Vue.ref(false), isFetching: Vue.ref(false), data: Vue.ref({ items, total: items.length }) }
  return { hydrated, allowed: state !== 'forbidden', can: () => state !== 'forbidden', t: (key: string) => key, query,
    items, columns: [], total: items.length, page: 1, pages: 1, setPage: () => {}, onSearch: () => {}, rowActions: () => [], openNew: () => {}, openCreate: () => {}, onSort: () => {}, refetch: () => {}, emptyTitleKey: 'tasks.empty.title', search: '', committedSearch: '', background: false, clearFilters: () => {}, update: () => {}, processTo: () => '/process/7', operationsStateTone: () => 'neutral', formatDateTime, timeZone: 'UTC',
    showList: true, isArchived: false, isBoard: false, views: [], params: {}, boardParams: {}, createTo: undefined, kpisShown: true, taskTo: () => '/tasks/7',
    filters: { mine: false }, countTags: [], archived: false, canListArchived: false, activeFilterCount: 0, statusOptions: [], statusFilter: 'all', sortOptions: [], sort: 'default',
    activeList: { error: Vue.ref(null) }, projectList: query, displayedItems: items, showEmpty: state === 'empty', emptyKey: 'empty', isLoading: false,
    resource: 'types', forbidden: state === 'forbidden', title: 'Catalog', returnTo: '/settings/apps/projects', q: '', scopes: [], showInactive: false, pendingItem: null, pendingAction: null,
    stageName: () => '—', minWidthClass: '', props: { variant: 'mine' }, rowTo: () => '/tasks/7', sortKeys: {}, TASK_SORT_KEYS: {}, showCreateAction: false, hasNextPage: true, isFetchingNextPage: false, error: state === 'error' ? new Error('Failure') : null,
  }
}

describe('settled lists render before hydration', () => {
  for (const [label, path] of [
    ['processes', 'components/operations/ProcessList.vue'],
    ['imports', 'components/crm/imports/CrmImportBatchList.vue'],
    ['projects', 'pages/projects/index.vue'],
    ['catalogs', 'pages/settings/apps/projects/catalogs/[resource]/index.vue'],
  ] as const) {
    it(`${label} emits rows and disables its pager before hydration`, async () => {
      const html = await render(templateComponent(path, bindings('rows')))
      expect(html).toContain(label === 'imports' ? 'Server import.csv' : 'Server row')
      expect(html).toContain('data-testid="ssr-pager" disabled')
      const hydrated = await render(templateComponent(path, bindings('rows', true)))
      expect(hydrated).toContain('data-testid="ssr-pager"')
      expect(hydrated).not.toContain('data-testid="ssr-pager" disabled')
      expect(html).not.toContain('Unexpected KPI request')
    })
    for (const state of ['empty', 'error', ...(label === 'projects' ? [] : ['forbidden'])] as State[]) {
      it(`${label} emits its ${state} branch during SSR`, async () => {
        const html = await render(templateComponent(path, bindings(state)))
        expect(html).toContain(state === 'empty' ? (label === 'catalogs' ? 'catalogs.empty' : 'SharedEmptyState') : state === 'error' ? (label === 'catalogs' ? 'Server failure' : 'SharedPageState') : label === 'catalogs' ? 'settings.forbidden' : 'SharedForbiddenState')
        expect(html).not.toContain('Server row')
      })
    }
  }
  it('tasks emits the table and disabled toolbar without mounting hidden KPIs', async () => {
    const html = await render(templateComponent('pages/tasks.vue', bindings('rows')))
    expect(html).toContain('Server task')
    expect(html).toContain('disabled')
    expect(html).not.toContain('Unexpected KPI request')
  })
  it('task deadline labels wait for the viewer clock while the row remains on the server', async () => {
    const tag = vi.fn(() => ({ text: 'Viewer deadline', tone: null }))
    const component = (hydrated: boolean) => templateComponent('components/pmo/tasks/TaskTable.vue', { ...bindings('rows', hydrated), deadlineCellView: tag, DEADLINE_TONE_CLASS: { plain: 'text-default' } })
    const html = await render(component(false))
    expect(html).toContain('Server row')
    expect(html).not.toContain('Viewer deadline')
    expect(tag).not.toHaveBeenCalled()
    expect(await render(component(true))).toContain('Viewer deadline')
  })
})

it('keeps the board placeholder local to the board without mounting viewer-clock cards', async () => {
  const html = await render(templateComponent('pages/tasks.vue', { ...bindings('rows'), isBoard: true }))
  expect(html).toContain('SharedLoadingSkeleton')
  expect(html).toContain('disabled')
  expect(html).not.toContain('Server task')
})

it.each(['components/pmo/projects/ProjectTable.vue', 'components/pmo/projects/ProjectCardBody.vue'])('%s postpones date-relative labels and preserves status-only progress tone', async path => {
  const project = { ...row, progress: 25, task_count: 4, closed_task_count: 1, phase: 'planning', date_end: '2026-11-06', status: 'on_track', active: true }
  const tone = vi.fn((item: typeof project) => item.date_end ? 'viewer-tone' : 'server-tone')
  const endTag = vi.fn(() => ({ label: 'Viewer deadline', title: 'End date' }))
  const subject = (hydrated: boolean) => templateComponent(path, {
    ...bindings('rows', hydrated), items: [project], project, toFor: () => '/projects/7', archive: { target: Vue.ref(null) },
    projectProgressTone: tone, projectStatusPill: () => ({ label: 'On track' }), PHASE_LABEL_KEY: { planning: 'Planning' },
    endTag: path.endsWith('ProjectTable.vue') ? endTag : { label: 'Viewer deadline' }, statusPill: { label: 'On track' }, taskLabel: '1 of 4', awaitingCharter: false,
  })
  const html = await render(subject(false))
  expect(html).toContain('Server row')
  expect(html).toContain('server-tone')
  expect(html).not.toContain('Viewer deadline')
  expect(endTag).not.toHaveBeenCalled()
  expect(tone).toHaveBeenCalledWith(expect.objectContaining({ date_end: null, status: 'on_track' }))
  const hydrated = await render(subject(true))
  expect(hydrated).toContain('Viewer deadline')
  expect(hydrated).toContain('viewer-tone')
})

it('imports use the identity timezone consistently across server and browser host zones', async () => {
  const source = parse(readFileSync(resolve(appRoot, 'components/crm/imports/CrmImportBatchList.vue'), 'utf8')).descriptor.scriptSetup!.content
  const body = ts.transpileModule(source.replace(/^import[^\n]*\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const query = { data: Vue.ref({ items: [row], total: 1 }) }
  const oldZone = process.env.TZ
  try {
    for (const userZone of ['Asia/Riyadh', undefined]) {
      const rendered = []
      for (const hostZone of ['UTC', 'Asia/Riyadh', 'America/Los_Angeles']) {
        process.env.TZ = hostZone
        const globals = {
          defineProps: () => ({}), useRoute: () => ({ query: {} }), useRouter: () => ({}),
          useI18n: () => ({ t: (key: string) => key }), useAccess: () => ({ can: () => true }), useHydrated: () => Vue.ref(false),
          useMe: () => ({ me: Vue.ref({ tz: userZone }) }), useCrmImportBatches: () => query, listPageNumber: () => 1, useLastPageClamp: () => {}, computed: Vue.computed,
        }
        const timeZone = new Function(...Object.keys(globals), `${body}\nreturn timeZone.value`)(...Object.values(globals))
        rendered.push(await render(templateComponent('components/crm/imports/CrmImportBatchList.vue', { ...bindings('rows'), timeZone })))
      }
      expect(new Set(rendered).size).toBe(1)
      expect(rendered[0]).toContain(userZone ? '06/11/2026 03:30' : '06/11/2026 00:30')
    }
  } finally { process.env.TZ = oldZone }
})
