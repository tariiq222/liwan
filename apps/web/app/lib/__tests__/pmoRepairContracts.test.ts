import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, createSSRApp, defineComponent, h, nextTick, ref, shallowRef, watch } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { CalendarDate } from '@internationalized/date'
import { createDebouncedFlush } from '../debouncedFlush'
import { describe, expect, it, vi } from 'vitest'
import { isDirtySnapshot } from '../formDirty'
import { validateMilestoneDates, validateTaskDates } from '../../utils/projectDateBounds'
import { buildTaskCreatePayload, validateTaskCreatePolicy } from '../../utils/taskCreatePolicy'
import { buildMilestonePatch } from '../../utils/milestonePayload'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

type SetupDeps = Record<string, unknown>

class TestApiError extends Error {}

function loadSetup(path: string, props: Record<string, unknown>, deps: SetupDeps = {}) {
  const filename = resolve(root, path)
  const parsed = parse(readFileSync(filename, 'utf8'), { filename })
  if (parsed.errors.length) throw parsed.errors[0]
  const script = compileScript(parsed.descriptor, { id: 'pmo-repair-test' })
  const importsRemoved = script.content
    .replace(/^import[^\n]*\n/gm, '')
    .replace('export default', 'return')
  const code = ts.transpileModule(importsRemoved, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const names = [
    'Vue', '_defineComponent', 'ref', 'computed', 'shallowRef', 'watch', 'nextTick',
    'useI18n', 'useHydrated', 'ApiError', 'isDirtySnapshot', 'useProjects', 'useProject', 'useMilestones', 'validateMilestoneDates', 'validateTaskDates', 'buildTaskCreatePayload', 'validateTaskCreatePolicy', 'buildMilestonePatch', 'useCreateTask',
    'formatCalendarDate', 'fromCalendarDate', 'toCalendarDate', 'useCreateMilestone',
    'useUpdateMilestone', 'useCreateProjectUpdate', 'PROJECT_STATUSES', 'PROJECT_STATUS_LABEL_KEY',
    'toast', 'useToast', 'DescriptionEditor', 'moveId', 'stageMoveIndex',
  ]
  const defaults: SetupDeps = {
    Vue,
    _defineComponent: Vue.defineComponent,
    ref,
    computed,
    shallowRef,
    watch,
    nextTick,
    useI18n: () => ({ t: (key: string) => key, locale: ref('en') }),
    useHydrated: () => ref(true),
    ApiError: TestApiError,
    isDirtySnapshot,
    useProjects: () => ({ data: ref([]) }),
    useProject: () => ({ data: ref(null), isLoading: ref(false), error: ref(null) }),
    useMilestones: () => ({ data: ref([]), isLoading: ref(false), error: ref(null) }),
    validateMilestoneDates,
    validateTaskDates,
    buildTaskCreatePayload,
    validateTaskCreatePolicy,
    buildMilestonePatch,
    useCreateTask: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    formatCalendarDate: () => '',
    fromCalendarDate: () => null,
    toCalendarDate: () => undefined,
    useCreateMilestone: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    useUpdateMilestone: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    useCreateProjectUpdate: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    PROJECT_STATUSES: ['in_progress'],
    PROJECT_STATUS_LABEL_KEY: { in_progress: 'tasks.state.inProgress' },
    toast: { success: vi.fn() },
    useToast: () => ({ add: vi.fn() }),
    DescriptionEditor: {},
    moveId: (items: unknown[]) => items,
    stageMoveIndex: (_length: number, from: number) => from,
  }
  const values = names.map(name => deps[name] ?? defaults[name])
  const component = new Function(...names, code)(...values) as { setup: Function }
  const events: unknown[][] = []
  const state = component.setup(props, {
    emit: (...event: unknown[]) => events.push(event),
    expose: () => {},
  }) as Record<string, any>
  return { state, events }
}

// Every component the template asks for is stubbed by name, read out of the
// compiled render itself: a hand-written list would go stale silently and the
// form would render without the guard under test.
async function renderedGuardDirty(path: string, state: Record<string, unknown>) {
  const filename = resolve(root, path)
  const parsed = parse(readFileSync(filename, 'utf8'), { filename })
  const compiled = compileTemplate({
    source: parsed.descriptor.template!.content,
    filename, id: 'pmo-repair-guard',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (compiled.errors.length) throw compiled.errors[0]
  const code = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', code)(Vue) as () => unknown
  let received: unknown
  const app = createSSRApp({ render: () => h(defineComponent({ setup: () => ({ ...state }), render })) })
  app.config.globalProperties.$t = (key: string) => key
  for (const match of code.matchAll(/_resolveComponent\("([^"]+)"\)/g)) {
    const name = match[1]!
    app.component(name, defineComponent({
      inheritAttrs: false,
      setup: (_, { slots, attrs }) => () => h('div', attrs, slots.default?.()),
    }))
  }
  app.component('SharedUnsavedChanges', defineComponent({
    props: { dirty: Boolean },
    setup(props) { received = props.dirty; return () => h('div', { 'data-guard': String(props.dirty) }) },
  }))
  const html = await renderToString(app)
  return { html, received }
}

describe('PMO repair form contracts', () => {
  it('reports a draft dirty until the save that carries it away succeeds', () => {
    expect(isDirtySnapshot('baseline', 'edited', false)).toBe(true)
    expect(isDirtySnapshot('baseline', 'edited', true)).toBe(false)
    expect(isDirtySnapshot('baseline', 'baseline', false)).toBe(false)
  })

  it.each([
    ['TaskCreateForm', 'apps/web/app/components/task/TaskCreateForm.vue', { projectId: 7 }, 'name'],
    ['MilestoneForm', 'apps/web/app/components/project/MilestoneForm.vue', { projectId: 7 }, 'name'],
    ['ProjectUpdateForm', 'apps/web/app/components/project/ProjectUpdateForm.vue', { projectId: 7 }, 'title'],
  ])('%s hands its own draft state to the departure guard', async (_name, path, props, field) => {
    const { state } = loadSetup(path, props)
    const clean = await renderedGuardDirty(path, state)
    expect(clean.html, 'the guard must be mounted, not conditional').toContain('data-guard=')
    expect(clean.received).toBe(false)

    ;(state[field] as { value: string }).value = 'مسودة'
    const dirty = await renderedGuardDirty(path, state)
    expect(dirty.received, 'an edited draft must reach the guard').toBe(true)
  })




  it('executes TaskCreateForm dirty, failed-save, and success transitions', async () => {
    const pending = ref(false)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let attempt = 0
    const mutateAsync = vi.fn(async () => {
      pending.value = true
      try {
        if (attempt++ === 0) {
          await gate
          throw new Error('save failed')
        }
        return { id: 41 }
      } finally {
        pending.value = false
      }
    })
    const { state, events } = loadSetup('apps/web/app/components/task/TaskCreateForm.vue', { projectId: 7 }, {
      useProjects: () => ({ data: ref([{ id: 7, name: 'Portal' }]) }),
      useCreateTask: () => ({ mutateAsync, isPending: pending }),
    })

    expect(state.dirty.value).toBe(false)
    state.name.value = 'New task'
    expect(state.dirty.value).toBe(true)
    const failed = state.submit()
    expect(pending.value).toBe(true)
    expect(state.dirty.value).toBe(true)
    release()
    await failed
    expect(state.dirty.value).toBe(true)
    await state.submit()
    expect(events).toEqual([['created', 41]])
    expect(state.dirty.value).toBe(false)
  })

  it('executes MilestoneForm dirty, failed-save, and success transitions', async () => {
    const pending = ref(false)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let attempt = 0
    const mutateAsync = vi.fn(async () => {
      pending.value = true
      try {
        if (attempt++ === 0) {
          await gate
          throw new Error('save failed')
        }
        return { id: 42 }
      } finally {
        pending.value = false
      }
    })
    const { state, events } = loadSetup('apps/web/app/components/project/MilestoneForm.vue', { projectId: 7, projectStart: '2030-01-01', projectEnd: '2030-12-31' }, {
      useCreateMilestone: () => ({ mutateAsync, isPending: pending }),
      useUpdateMilestone: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    })

    state.name.value = 'Release'
    state.startDate.value = new CalendarDate(2030, 2, 1)
    state.deadline.value = new CalendarDate(2030, 2, 28)
    expect(state.dirty.value).toBe(true)
    const failed = state.submit()
    expect(pending.value).toBe(true)
    release()
    await failed
    expect(state.dirty.value).toBe(true)
    await state.submit()
    expect(events).toEqual([['saved', 42]])
    expect(state.dirty.value).toBe(false)
  })

  it('executes ProjectUpdateForm immediate body capture, failed-save retention, and success reset', async () => {
    const pending = ref(false)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let attempt = 0
    const payloads: unknown[] = []
    const mutateAsync = vi.fn(async (payload: unknown) => {
      payloads.push(payload)
      pending.value = true
      try {
        if (attempt++ === 0) {
          await gate
          throw new Error('save failed')
        }
        return {}
      } finally {
        pending.value = false
      }
    })
    const { state, events } = loadSetup('apps/web/app/components/project/ProjectUpdateForm.vue', { projectId: 7 }, {
      useCreateProjectUpdate: () => ({ mutateAsync, isPending: pending }),
    })
    const autosave = vi.fn()
    const buffer = createDebouncedFlush<{ html: string; taskId: number }>(800, autosave)
    const flush = vi.fn(() => buffer.flush())
    state.descriptionEditor.value = { flush }
    state.title.value = 'Weekly update'
    state.onDescriptionDraft({ html: '<p>latest body</p>', taskId: 7 })
    buffer.schedule({ html: '<p>latest body</p>', taskId: 7 })

    const failed = state.submit()
    expect(flush).toHaveBeenCalledOnce()
    expect(autosave).toHaveBeenCalledExactlyOnceWith({ html: '<p>latest body</p>', taskId: 7 })
    expect(payloads[0]).toEqual({ projectId: 7, body: { name: 'Weekly update', description: '<p>latest body</p>' } })
    expect(pending.value).toBe(true)
    expect(state.dirty.value).toBe(true)
    release()
    await failed
    expect(state.dirty.value).toBe(true)
    await state.submit()
    expect(events).toEqual([['saved']])
    expect(state.dirty.value).toBe(false)
  })

  it('executes StageListEditor request, cancel, confirm, and nonempty protection', () => {
    const stages = [
      { id: 1, name: 'Empty', fold: false, task_count: 0 },
      { id: 2, name: 'In use', fold: false, task_count: 3 },
    ]
    const { state, events } = loadSetup('apps/web/app/components/project/StageListEditor.vue', { stages, busy: false })

    state.requestDelete(1)
    expect(state.pendingDeleteId.value).toBe(1)
    expect(events).toEqual([])
    state.cancelDelete()
    expect(state.pendingDeleteId.value).toBe(null)
    state.requestDelete(1)
    state.confirmDelete(1)
    expect(events).toEqual([['delete', 1]])
    expect(state.pendingDeleteId.value).toBe(null)
    expect(stages[1]?.task_count, 'the occupied stage is what the tooltip covers').toBeGreaterThan(0)
  })
})
