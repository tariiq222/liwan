import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { DEFAULT_STUBS, loadShared, renderShared } from '@liwan/ui/test/helpers/renderShared'
import { filterWorkRows, groupByWork, mergeAttentionRows, parseWorkKind, sourcesOf, WORK_ROWS_LIMIT, workCountLabel } from '../../composables/nav/attentionModel'
import type { AppAttentionProvider, AppWorkKind } from '../../modules/types'

const file = resolve(import.meta.dirname, '../work.vue')
const rowFile = resolve(import.meta.dirname, '../../components/work/WorkRow.vue')
const NuxtLink = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: props.to }, slots.default?.()) })
const UButton = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' }, label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('a', { ...attrs, href: props.to }, props.label) })
const UBadge = Vue.defineComponent({ inheritAttrs: false, props: { label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('span', attrs, props.label) })
const UInput = Vue.defineComponent({ inheritAttrs: false, props: { modelValue: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('input', { ...attrs, value: props.modelValue }) })
const USelect = Vue.defineComponent({
  inheritAttrs: false,
  props: { items: { type: Array, default: () => [] } },
  setup: (props, { attrs }) => () => Vue.h('select', attrs, (props.items as Array<{ value: string; label: string }>).map(item => Vue.h('option', { value: item.value }, item.label))),
})
const slot = (tag: string, extra: Record<string, unknown> = {}) => Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h(tag, { ...attrs, ...extra }, [slots.filters?.(), slots.default?.()]) })
const SharedPageHeader = Vue.defineComponent({ props: { title: { type: String, default: '' } }, setup: (props, { slots }) => () => Vue.h('header', [Vue.h('h1', props.title), slots.default?.()]) })
const SharedSegmentedControl = Vue.defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' }, items: { type: Array, default: () => [] }, disabled: Boolean },
  setup: (props, { attrs }) => () => Vue.h('div', attrs, (props.items as Array<{ value: string; label: string }>).map(item => Vue.h('button', { 'aria-pressed': String(item.value === props.modelValue), 'data-value': item.value, disabled: props.disabled }, item.label))),
})
const SharedFilterBar = Vue.defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => Vue.h('div', [slots.search?.(), slots.default?.()]) })
const SharedEmptyState = Vue.defineComponent({ inheritAttrs: false, props: { title: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('div', attrs, props.title) })
const SharedErrorState = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('div', { ...attrs, role: 'alert' }, 'error') })
const SharedLoadingSkeleton = Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': 'work-loading' }) })

const messages: Record<string, string> = {
  'myTasks.work.title': 'مهامي', 'myTasks.work.description': 'أعمالك وما ينتظر قرارك وما تتابعه في مكان واحد', 'myTasks.work.myList': 'قائمة مهامي', 'myTasks.new': 'مهمة جديدة',
  'myTasks.work.kindsLabel': 'نوع العمل', 'myTasks.work.kinds.execute': 'للتنفيذ', 'myTasks.work.kinds.decide': 'للقرار', 'myTasks.work.kinds.follow': 'للمتابعة',
  'myTasks.work.search': 'ابحث في أعمالك', 'myTasks.work.source': 'التطبيق', 'myTasks.work.allSources': 'كل التطبيقات', 'myTasks.work.urgent': 'عاجل', 'myTasks.work.noMatch': 'لا توجد نتائج مطابقة',
  'myTasks.work.empty.execute': 'لا شيء للتنفيذ', 'myTasks.work.empty.decide': 'لا شيء للقرار', 'myTasks.work.empty.follow': 'لا شيء للمتابعة',
  'nav.myTasks': 'مهامي', 'nav.operations': 'العمليات',
}

const provider = (id: string, module: string, work: AppWorkKind): AppAttentionProvider => ({ id, module, work, capability: `${module}.read`, queryKey: ['attention', id], load: async () => [] })
const rowsOf = (spec: Array<[AppWorkKind, string, string, 'urgent' | 'normal', string?]>) => mergeAttentionRows(
  spec.map(([work, module, label, tone, suggestion], index) => ({
    provider: provider(`${module}-${work}`, module, work),
    rows: [{ id: String(index), label, to: `/${module}/${index}`, tone, ...(suggestion ? { suggestion } : {}) }],
  })), WORK_ROWS_LIMIT)

interface Setup { rows?: ReturnType<typeof rowsOf>; capped?: string[]; pending?: boolean; failed?: boolean; tab?: unknown; create?: boolean; hydrated?: boolean }
async function render({ rows = [], capped = [], pending = false, failed = false, tab, create = true, hydrated = true }: Setup = {}) {
  const useAttention = vi.fn(() => ({ rows: Vue.computed(() => rows), pending: Vue.computed(() => pending), failed: Vue.computed(() => failed), cappedKinds: Vue.computed(() => capped), refetch: vi.fn() }))
  const WorkRow = { __esModule: true, default: loadShared(rowFile, { messages, stubs: { ...DEFAULT_STUBS, NuxtLink, UBadge } }) }
  const html = await renderShared(file, {}, {}, {
    messages, hydrated,
    stubs: { ...DEFAULT_STUBS, NuxtLink, UButton, UBadge, UInput, USelect, SharedPageContainer: slot('main'), SharedPageHeader, SharedListCard: slot('section'), SharedSegmentedControl, SharedFilterBar, SharedEmptyState, SharedErrorState, SharedLoadingSkeleton },
    globals: {
      useRoute: () => ({ query: tab === undefined ? {} : { tab } }), useRouter: () => ({ push: vi.fn() }),
      useAccess: () => ({ can: (capability: string) => create || capability !== 'tasks.tasks.create' }),
      onMounted: Vue.onMounted,
    },
    modules: {
      '@/composables/useAttention': { useAttention },
      '@/composables/useModuleLabel': { useModuleLabel: () => (module: string) => ({ tasks: 'مهامي', operations: 'العمليات' })[module] ?? module },
      '@/composables/nav/attentionModel': { groupByWork, parseWorkKind, WORK_ROWS_LIMIT, WORK_KINDS: ['execute', 'decide', 'follow'], filterWorkRows, sourcesOf, workCountLabel },
      '@/components/work/WorkRow.vue': WorkRow,
    },
  })
  return { html, useAttention }
}

const sample = rowsOf([
  ['execute', 'tasks', 'مهمة عادية', 'normal'],
  ['execute', 'tasks', 'مهمة متأخرة', 'urgent', 'ابدأ بها'],
  ['decide', 'operations', 'طلب شراء', 'urgent'],
])

describe('work page', () => {
  it('disables tabs, search and source until hydration and enables them afterward', async () => {
    const before = (await render({ rows: sample, hydrated: false })).html
    const after = (await render({ rows: sample, hydrated: true })).html
    for (const id of ['work-search', 'work-source']) {
      expect(before.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0]).toContain('disabled')
      expect(after.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0]).not.toContain('disabled')
    }
    expect(before).toMatch(/data-value="decide" disabled/)
    expect(after).not.toMatch(/data-value="decide" disabled/)
  })

  it('has the title, the description and the links to the plain list and to a new task', async () => {
    const { html } = await render({ rows: sample })
    expect(html).toContain('<h1>مهامي</h1>')
    expect(html).toContain('أعمالك وما ينتظر قرارك وما تتابعه في مكان واحد')
    expect(html).toMatch(/href="\/my-tasks"[^>]*>قائمة مهامي</)
    expect(html).toMatch(/href="\/my-tasks\/new"[^>]*>مهمة جديدة</)
  })

  it('hides the new-task action from someone who may not create tasks', async () => {
    expect((await render({ rows: sample, create: false })).html).not.toContain('work-new-task')
  })

  it('reads every application with the work limit', async () => {
    const { useAttention } = await render({ rows: sample })
    expect(useAttention).toHaveBeenCalledWith('all', { limit: WORK_ROWS_LIMIT })
  })

  it('counts each kind in its tab and opens the first kind by default', async () => {
    const { html } = await render({ rows: sample })
    expect(html).toMatch(/aria-pressed="true" data-value="execute">للتنفيذ \(2\)</)
    expect(html).toContain('للقرار (1)')
    expect(html).toContain('للمتابعة (0)')
  })

  it('shows a plus on a tab whose provider returned all it may', async () => {
    const { html } = await render({ rows: sample, capped: ['decide'] })
    expect(html).toContain('للقرار (1+)')
    expect(html).toContain('للتنفيذ (2)')
  })

  it('lists the rows of the kind in the URL, urgent first, each with its source and suggestion', async () => {
    const execute = (await render({ rows: sample })).html
    expect(execute.indexOf('مهمة متأخرة')).toBeLessThan(execute.indexOf('مهمة عادية'))
    expect(execute).not.toContain('طلب شراء')
    expect(execute).toContain('ابدأ بها')
    expect(execute).toMatch(/data-testid="work-row-source"[^>]*>مهامي</)
    const decide = (await render({ rows: sample, tab: 'decide' })).html
    expect(decide).toMatch(/aria-pressed="true" data-value="decide"/)
    expect(decide).toContain('طلب شراء')
    expect(decide).toMatch(/data-testid="work-row-source"[^>]*>العمليات</)
    expect(decide).not.toContain('مهمة عادية')
  })

  it('falls back to the first kind for an unknown or repeated tab value', async () => {
    expect((await render({ rows: sample, tab: 'nonsense' })).html).toMatch(/aria-pressed="true" data-value="execute"/)
    expect((await render({ rows: sample, tab: ['decide', 'follow'] })).html).toMatch(/aria-pressed="true" data-value="execute"/)
  })

  it('offers the applications present in the rows in the source filter', async () => {
    const { html } = await render({ rows: sample })
    expect(html).toContain('<option value="all">كل التطبيقات</option>')
    expect(html).toContain('<option value="tasks">مهامي</option>')
    expect(html).toContain('<option value="operations">العمليات</option>')
    expect(html).toContain('data-testid="work-search"')
  })

  it('has an empty state per kind', async () => {
    expect((await render({ rows: sample, tab: 'follow' })).html).toMatch(/data-testid="work-empty"[^>]*>لا شيء للمتابعة</)
    expect((await render({ rows: [] })).html).toMatch(/data-testid="work-empty"[^>]*>لا شيء للتنفيذ</)
  })

  it('shows a loading skeleton while the providers load and the shared error state when all fail', async () => {
    const loading = (await render({ pending: true })).html
    expect(loading).toContain('work-loading')
    expect(loading).not.toContain('work-empty')
    const failed = (await render({ failed: true })).html
    expect(failed).toContain('data-testid="work-error"')
    expect(failed).not.toContain('work-empty')
  })
})
