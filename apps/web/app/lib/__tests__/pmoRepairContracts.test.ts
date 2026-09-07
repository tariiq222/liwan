import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { createDebouncedFlush } from '../debouncedFlush'
import { describe, expect, it, vi } from 'vitest'
import { isDirtySnapshot } from '../formDirty'

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
    'useI18n', 'useHydrated', 'ApiError', 'isDirtySnapshot', 'useProjects', 'useCreateTask',
    'formatCalendarDate', 'fromCalendarDate', 'toCalendarDate', 'useCreateMilestone',
    'useUpdateMilestone', 'useCreateProjectUpdate', 'PROJECT_STATUSES', 'PROJECT_STATUS_LABEL_KEY',
    'toast', 'DescriptionEditor', 'moveId', 'stageMoveIndex',
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

describe('PMO repair form contracts', () => {
  it.each([
    ['TaskCreateForm', 'apps/web/app/components/task/TaskCreateForm.vue'],
    ['MilestoneForm', 'apps/web/app/components/project/MilestoneForm.vue'],
    ['ProjectUpdateForm', 'apps/web/app/components/project/ProjectUpdateForm.vue'],
  ])('%s protects drafts until successful navigation', (_name, path) => {
    const form = source(path)
    expect(form).toContain('<SharedUnsavedChanges :dirty="dirty" />')
    expect(form).toContain('const submitted = ref(false)')
    expect(form).toContain('submitted.value = true')
    expect(isDirtySnapshot('baseline', 'edited', false)).toBe(true)
    expect(isDirtySnapshot('baseline', 'edited', true)).toBe(false)
    expect(isDirtySnapshot('baseline', 'baseline', false)).toBe(false)
  })

  it('submits the latest update body while keeping autosave delayed', () => {
    const form = source('apps/web/app/components/project/ProjectUpdateForm.vue')
    const editor = source('apps/web/app/components/task/DescriptionEditor.vue')
    expect(form).toContain('descriptionEditor.value?.flush()')
    expect(form).toContain('@draft="onDescriptionDraft"')
    expect(form).toContain(':readonly="isPending"')
    expect(editor).toContain('draft: [{ html: string; taskId: number }]')
    expect(editor).toContain('buffer.schedule(draft)')
    expect(editor).toContain('if (props.readonly) return')
  })

  it('keeps field purpose and selected value in popover accessible names', () => {
    const general = source('apps/web/app/components/project/ProjectGeneralForm.vue')
    const charter = source('apps/web/app/components/project/ProjectCharterFields.vue')
    const details = source('apps/web/app/components/task/TaskDetails.vue')
    expect(general).toContain('aria-labelledby="project-settings-date-start-label project-settings-date-start-value"')
    expect(general).toContain('aria-labelledby="project-settings-date-end-label project-settings-date-end-value"')
    expect(general).toContain('project-settings-manager-label project-settings-manager-value')
    expect(charter).toContain('charter-type-label charter-type-value')
    expect(charter).toContain('charter-owning-unit-label charter-owning-unit-value')
    expect(charter).toContain('charter-sponsor-label charter-sponsor-value')
    expect(charter).toContain('charter-manager-label charter-manager-value')
    expect(charter).toContain('charter-date-start-label charter-date-start-value')
    expect(charter).toContain('charter-date-end-label charter-date-end-value')
    expect(details).toContain('aria-labelledby="task-deadline-label task-deadline-value"')
  })

  it('requires explicit confirmation before deleting an empty stage', () => {
    const stageEditor = source('apps/web/app/components/project/StageListEditor.vue')
    expect(stageEditor).toContain('const pendingDeleteId = ref')
    expect(stageEditor).toMatch(/@click="requestDelete\(stage\.id\)"/)
    expect(stageEditor).toMatch(/@click="confirmDelete\(stage\.id\)"/)
    expect(stageEditor).toContain('pendingDeleteId.value !== stageId')
    expect(stageEditor).toContain('task_count ?? 0')
    expect(stageEditor).toContain('data-testid="stage-delete-confirm"')
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
    const { state, events } = loadSetup('apps/web/app/components/project/MilestoneForm.vue', { projectId: 7 }, {
      useCreateMilestone: () => ({ mutateAsync, isPending: pending }),
      useUpdateMilestone: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
    })

    state.name.value = 'Release'
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
    state.status.value = 'in_progress'
    state.title.value = 'Weekly update'
    state.onDescriptionDraft({ html: '<p>latest body</p>', taskId: 7 })
    buffer.schedule({ html: '<p>latest body</p>', taskId: 7 })

    const failed = state.submit()
    expect(flush).toHaveBeenCalledOnce()
    expect(autosave).toHaveBeenCalledExactlyOnceWith({ html: '<p>latest body</p>', taskId: 7 })
    expect(payloads[0]).toEqual({ projectId: 7, body: { status: 'in_progress', name: 'Weekly update', description: '<p>latest body</p>' } })
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
    const template = source('apps/web/app/components/project/StageListEditor.vue')
    expect(template).toContain('<template v-if="(stage.task_count ?? 0) === 0">')
    expect(template).toContain('<Tooltip v-else>')
    expect(stages[1].task_count).toBeGreaterThan(0)
  })
})
