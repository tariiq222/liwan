import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { budgetStatus, financeSummaryMode, formatNullableAmount, formatUtilization, isExternalActual } from '../../../../utils/projectFinance'
import { projectSectionLocation } from '../../../../utils/projectWorkspaceMemory'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { isDirtySnapshot } from '../../../../lib/formDirty'
import { ApiError } from '../../../../composables/useApi'

const route = {
  params: { id: '12' }, path: '/projects/12/raci',
  query: { returnTo: '/projects?mine=1', projectListReturnTo: '/projects?mine=1', taskContext: '{"view":"board","q":"site","closed":"1"}', task_q: 'missing' },
  fullPath: '/projects/12/raci?task_q=missing&returnTo=%2Fprojects%3Fmine%3D1',
}
const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const passthrough = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('div', attrs, Object.values(slots).flatMap(slot => slot?.() ?? [])) })

function load(path: string, extra: Record<string, unknown> = {}) {
  const filename = resolve(import.meta.dirname, path)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'projects-consistency' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replaceAll('import.meta.server', 'false').replace('export default', 'return')
  const dependencies = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed,
    useI18n: () => ({ t: (key: string) => key }), useRoute: () => route, useRouter: () => ({}), useHydrated: () => Vue.ref(true),
    budgetStatus, financeSummaryMode, formatNullableAmount, formatUtilization, isExternalActual, projectSectionLocation, returnToQuery, isDirtySnapshot, ApiError,
    DescriptionEditor: passthrough, FinanceActualSource: passthrough, FinanceActualAccountPicker: passthrough, FilterBar: passthrough, RaciMatrix: passthrough, SharedSegmentedControl: passthrough, RACI_ROLE_TONE: {},
    ...extra,
  }
  const component = new Function(...Object.keys(dependencies), transpile(script))(...Object.values(dependencies))
  const compiled = compileTemplate({ source: descriptor.template!.content, filename, id: 'projects-consistency', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(compiled.code))(Vue)
  return { component, render }
}

async function renderView(view: ReturnType<typeof load>, props: Record<string, unknown>) {
  const app = Vue.createSSRApp({ render: () => Vue.h({
    ...view.component, render: view.render,
    async setup(props: Record<string, unknown>, context: unknown) {
      return { ...await view.component.setup(props, context) }
    },
  }, props) })
  for (const name of ['FilterBar', 'RaciMatrix', 'UBadge', 'UAlert', 'DescriptionEditor', 'SharedInlineConfirm', 'SharedRecordSection', 'SharedMetricTile', 'SharedFormActions', 'SharedUnsavedChanges', 'UFormField', 'UInput', 'SharedListPage', 'SharedPageState', 'SharedEmptyState', 'SharedPagination', 'SharedFilterChip', 'UTabs', 'SharedListCard', 'SharedStatusBadge', 'SharedProgress']) app.component(name, passthrough)
  app.component('UButton', Vue.defineComponent({ props: ['to', 'label'], setup: (props, { slots, attrs }) => () => Vue.h('a', { ...attrs, href: props.to ? router.resolve(props.to).href : undefined }, props.label || slots.default?.()) }))
  return renderToString(app)
}
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: passthrough }] })
const summary = { currency: { id: 1, name: 'SAR', symbol: 'SAR', decimal_places: 2 }, planned: 100, actual: 20, remaining: 80, utilization_percent: 20, over_budget: false, budget_count: 1, expense_count: 1, charter_estimate: null, actual_source: 'manual', actual_account: null, can_read_actual_lines: false, can_choose_actual_account: false }
const finance = () => load('../finance/FinanceSummaryCards.vue')

describe('project finance estimate reference', () => {
  it('keeps budget figures while hiding an absent estimate', async () => {
    const html = await renderView(finance(), { projectId: 12, summary })
    expect(html).toContain('100.00 SAR')
    expect(html).not.toContain('project-finance-charter')
  })
  it.each([0, 125])('shows a recorded estimate of %s alongside the budget', async estimate => {
    const html = await renderView(finance(), { projectId: 12, summary: { ...summary, charter_estimate: estimate } })
    expect(html).toContain('project-finance-charter')
    expect(html).toContain(`${estimate.toFixed(2)} SAR`)
    expect(html).toContain('100.00 SAR')
  })
  it('keeps zero as an estimate when no ledger entries exist', async () => {
    const html = await renderView(finance(), { projectId: 12, summary: { ...summary, planned: null, actual: 0, budget_count: 0, expense_count: 0, charter_estimate: 0 } })
    expect(html).toContain('project-finance-charter')
    expect(html).toContain('0.00 SAR')
    expect(html).not.toContain('projects.finance.planned')
  })
  it('hides the summary when neither ledger entries nor estimate exist', async () => {
    const html = await renderView(finance(), { projectId: 12, summary: { ...summary, planned: null, budget_count: 0, expense_count: 0 } })
    expect(html).not.toContain('project-finance-summary')
  })
  it.each([0, 125])('keeps estimate %s separate from expenses when budget is unknown', async estimate => {
    const html = await renderView(finance(), { projectId: 12, summary: { ...summary, planned: null, budget_count: 0, charter_estimate: estimate } })
    expect(html).toContain('projects.finance.budgetUnknown')
    expect(html).toContain('20.00 SAR')
    expect(html).toContain('project-finance-charter')
    expect(html).toContain(`${estimate.toFixed(2)} SAR`)
    expect(html).not.toContain('projects.finance.planned')
  })
  it('does not turn expenses with unknown budget into a budget dashboard', async () => {
    const html = await renderView(finance(), { projectId: 12, summary: { ...summary, planned: null, budget_count: 0 } })
    expect(html).toContain('projects.finance.budgetUnknown')
    expect(html).toContain('20.00 SAR')
    expect(html).not.toContain('projects.finance.planned')
    expect(html).not.toContain('project-finance-charter')
  })
})

describe('project finance with an external actual', () => {
  const external = { ...summary, actual_source: 'external', actual_account: { id: 3, name: 'Tower', code: null }, can_read_actual_lines: true, can_choose_actual_account: false }
  // The harness registers neither child component, so each renders as its own tag name.
  const view = () => load('../finance/FinanceSummaryCards.vue')
  it('shows where the actual comes from on the tile and the cost center chooser only to who may choose', async () => {
    const html = await renderView(view(), { projectId: 12, summary: external })
    expect(html).toContain('<FinanceActualSource')
    expect(html).toContain('projects.finance.actualLineCount')
    expect(html).not.toContain('projects.finance.expenseCount')
    expect(html).not.toContain('<FinanceActualAccountPicker')
    expect(await renderView(view(), { projectId: 12, summary: { ...external, can_choose_actual_account: true } })).toContain('<FinanceActualAccountPicker')
  })
  it('shows the source even when no budget and no line exist yet', async () => {
    const html = await renderView(view(), { projectId: 12, summary: { ...external, planned: null, actual: 0, budget_count: 0, expense_count: 0, can_choose_actual_account: true } })
    expect(html).toContain('project-finance-summary')
    expect(html).toContain('<FinanceActualSource')
    expect(html).toContain('<FinanceActualAccountPicker')
  })
  it('leaves a manual actual exactly as before', async () => {
    const html = await renderView(view(), { projectId: 12, summary: { ...summary, can_choose_actual_account: true } })
    expect(html).not.toContain('<FinanceActualSource')
    expect(html).not.toContain('<FinanceActualAccountPicker')
    expect(html).toContain('projects.finance.expenseCount')
  })
})

function updateForm() {
  const mutate = vi.fn(async (_input: unknown) => ({}))
  const view = load('../ProjectUpdateForm.vue', { useCreateProjectUpdate: () => ({ mutateAsync: mutate, isPending: Vue.ref(false) }), useToast: () => ({ add: vi.fn() }) })
  return { ...view, mutate }
}
describe('project update publication', () => {
  it('names the submit action by its published result', async () => {
    const html = await renderView(updateForm(), { projectId: 12 })
    expect(html).toContain('projects.updates.publish')
    expect(html).not.toContain('app.create')
  })
  it('flushes the latest editor draft before publication and clears its dirty guard only on success', async () => {
    const view = updateForm()
    const emit = vi.fn()
    const state = view.component.setup({ projectId: 12 }, { emit, expose: () => {} })
    state.title.value = '  Weekly update  '
    state.descriptionEditor.value = { flush: () => { state.description.value = '<p>Latest content</p>' } }
    expect(state.dirty.value).toBe(true)
    await state.submit()
    expect(view.mutate).toHaveBeenCalledWith({ projectId: 12, body: { name: 'Weekly update', description: '<p>Latest content</p>' } })
    expect(emit).toHaveBeenCalledWith('saved')
    expect(state.dirty.value).toBe(false)
  })
  it('retains the draft and its guard when publication fails', async () => {
    const view = updateForm()
    view.mutate.mockRejectedValueOnce(new ApiError(500, 'http_error', 'Failed'))
    const emit = vi.fn()
    const state = view.component.setup({ projectId: 12 }, { emit, expose: () => {} })
    state.title.value = 'Weekly update'
    await state.submit()
    expect(state.dirty.value).toBe(true)
    expect(state.title.value).toBe('Weekly update')
    expect(state.error.value).toBe('Failed')
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('RACI task prerequisite navigation', () => {
  it('opens canonical tasks with their remembered board filters and project list origin', async () => {
    const query = () => ({ data: Vue.ref({ items: [], total: 0, can_manage: false }), isLoading: Vue.ref(false), isFetching: Vue.ref(false), error: Vue.ref(null) })
    const mutation = () => ({ isPending: Vue.ref(false) })
    const view = load('../../../../pages/projects/[id]/raci.vue', {
      useQueryClient: () => ({}), governanceMatrixFilters: () => ({ taskQ: 'missing', stakeholderQ: '', closed: false, taskPage: 0, stakeholderPage: 0 }),
      useGovernanceTaskPage: query, useProjectStakeholders: query, useProjectRaci: query,
      useCreateProjectRaci: mutation, useUpdateProjectRaci: mutation, useDeleteProjectRaci: mutation,
    })
    const html = await renderView(view, {})
    const href = html.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')
    const destination = new URL(href!, 'http://webvue.local')
    expect(destination.pathname).toBe('/projects/12/tasks')
    expect(Object.fromEntries(destination.searchParams)).toEqual({ q: 'site', view: 'board', closed: '1', returnTo: '/projects?mine=1', projectListReturnTo: '/projects?mine=1' })
    expect(html).not.toContain('tab=tasks')
    expect(html).not.toContain('/stakeholders/new')
  })
})
