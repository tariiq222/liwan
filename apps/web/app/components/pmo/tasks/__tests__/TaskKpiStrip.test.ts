import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../TaskKpiStrip.vue')
const projectFile = resolve(import.meta.dirname, '../../projects/ProjectKpiStrip.vue')

const SharedKpiStrip = Vue.defineComponent({ inheritAttrs: false, props: { loading: Boolean }, setup: (props, { attrs }) => () => Vue.h('section', { ...attrs, 'data-loading': String(props.loading) }) })
function errorStub(retry: (callback: () => void) => void) {
  return Vue.defineComponent({ emits: ['retry'], setup: (_, { attrs, emit }) => { retry(() => emit('retry')); return () => Vue.h('div', { ...attrs, role: 'alert' }, 'error') } })
}

async function render(path: string, modules: Record<string, unknown>, query: Record<string, unknown>, retry: (callback: () => void) => void = () => {}) {
  return renderShared(path, { params: { closed: false }, filters: {} }, {}, {
    stubs: { SharedKpiStrip, SharedErrorState: errorStub(retry) },
    modules: { ...modules, './kpiShares': { kpiSharesApply: () => true } },
    globals: { ...query },
  })
}

describe('KPI strips', () => {
  it.each([
    ['task', file, '@/composables/useTasks', 'useTaskSummary', 'task-kpi-error'],
    ['project', projectFile, '@/composables/useProjects', 'useProjectSummary', 'project-kpi-error'],
  ])('%s strip shows an error with retry instead of loading forever', async (_n, path, module, hook, testid) => {
    const refetch = vi.fn()
    let retry!: () => void
    const html = await render(path, { [module]: { [hook]: () => ({ data: Vue.ref(undefined), isError: Vue.ref(true), error: Vue.ref(new Error('x')), refetch }) } }, {}, (callback) => { retry = callback })
    expect(html).toContain(testid)
    expect(html).not.toContain('data-loading')
    retry()
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('task strip still shows the skeleton while the query is loading', async () => {
    const html = await render(file, { '@/composables/useTasks': { useTaskSummary: () => ({ data: Vue.ref(undefined), isError: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }) } }, {})
    expect(html).toContain('data-loading="true"')
    expect(html).not.toContain('task-kpi-error')
  })
})
