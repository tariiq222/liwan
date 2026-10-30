import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, loadShared, renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../HomeFocus.vue')
const rowFile = resolve(import.meta.dirname, '../../work/WorkRow.vue')
const NuxtLink = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' } }, setup: (props, { attrs, slots }) => () => Vue.h('a', { ...attrs, href: props.to }, slots.default?.()) })
const UButton = Vue.defineComponent({ inheritAttrs: false, props: { to: { type: String, default: '' }, label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('a', { ...attrs, href: props.to }, props.label) })
const UBadge = Vue.defineComponent({ inheritAttrs: false, props: { label: { type: String, default: '' } }, setup: (props, { attrs }) => () => Vue.h('span', attrs, props.label) })
const SharedLoadingSkeleton = Vue.defineComponent({ setup: () => () => Vue.h('div', { 'data-testid': 'skeleton' }) })
const messages = { 'home.focus': 'ابدأ بالأهم', 'home.viewAll': 'عرض الكل', 'home.focusEmpty': 'لا شيء عاجل الآن.', 'myTasks.work.urgent': 'عاجل' }
const row = (id: number, tone: 'urgent' | 'normal' = 'normal') => ({ id: `r${id}`, label: `بند ${id}`, to: `/x/${id}`, tone, module: 'tasks', work: 'execute' })

async function render({ available = true, pending = false, failed = false, refetch = vi.fn(), retry = (_callback: () => void) => {}, rows = [] as ReturnType<typeof row>[] } = {}) {
  const WorkRow = { __esModule: true, default: loadShared(rowFile, { messages, stubs: { ...DEFAULT_STUBS, NuxtLink, UBadge } }) }
  return renderShared(file, {}, {}, {
    messages, stubs: { ...DEFAULT_STUBS, NuxtLink, UButton, UBadge, SharedLoadingSkeleton, SharedErrorState: Vue.defineComponent({ emits: ['retry'], setup: (_, { attrs, emit }) => { retry(() => emit('retry')); return () => Vue.h('div', { ...attrs, role: 'alert' }, 'error') } }) },
    modules: {
      '@/components/work/WorkRow.vue': WorkRow,
      '@/composables/useModuleLabel': { useModuleLabel: () => () => 'مهامي' },
      '@/composables/useMyWork': { useMyWork: () => ({ available: Vue.computed(() => available), pending: Vue.computed(() => pending), failed: Vue.computed(() => failed), refetch, rows: Vue.computed(() => rows) }) },
    },
  })
}

describe('HomeFocus', () => {
  it('shows failure instead of an empty success and retries the work providers', async () => {
    const refetch = vi.fn()
    let retry!: () => void
    const html = await render({ failed: true, refetch, retry: callback => { retry = callback } })
    expect(html).toContain('home-focus-error')
    expect(html).not.toContain('home-focus-empty')
    retry()
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the first three rows in the order it gets them, with a link to the whole work page', async () => {
    const html = await render({ rows: [row(1, 'urgent'), row(2), row(3), row(4)] })
    expect(html).toContain('ابدأ بالأهم')
    expect(html.match(/data-testid="work-row"/g)).toHaveLength(3)
    expect(html.indexOf('بند 1')).toBeLessThan(html.indexOf('بند 2'))
    expect(html).not.toContain('بند 4')
    expect(html).toMatch(/href="\/work"[^>]*>عرض الكل</)
  })

  it('says so when there is nothing to start with, and shows a skeleton while loading', async () => {
    expect(await render({ rows: [] })).toContain('لا شيء عاجل الآن.')
    const loading = await render({ pending: true })
    expect(loading).toContain('skeleton')
    expect(loading).not.toContain('home-focus-empty')
  })

  it('is hidden when the user has no work page', async () => {
    expect(await render({ available: false, rows: [row(1)] })).not.toContain('home-focus')
  })
})
