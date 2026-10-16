import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as VueRouter from 'vue-router'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScheduleTaskPatchSchema, type ScheduleTask } from '@nasq/contracts'
import { DEFAULT_STUBS, loadShared, renderShared, sharedFile } from '@nasq/ui/test/helpers/renderShared'
import { ApiError } from '../../../../composables/useApi'
import { validateTaskDates } from '../../../../utils/projectDateBounds'
import { errorStateKind } from '@nasq/ui/app/utils/errorState'
import { formatCalendarDate } from '@nasq/ui/app/composables/calendarDate'

interface HostNode {
  type: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  text?: string
}
const node = (type = 'root'): HostNode => ({ type, props: {}, children: [], parent: null })
const renderer = Vue.createRenderer<HostNode, HostNode>({
  patchProp: (element, key, _old, value) => { element.props[key] = value },
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child)
    else parent.children.splice(index, 0, child)
  },
  remove(child) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  },
  createElement: node,
  createText: text => ({ ...node('text'), text }),
  createComment: text => ({ ...node('comment'), text }),
  setText: (element, text) => { element.text = text },
  setElementText: (element, text) => { element.text = text; element.children = [] },
  parentNode: element => element.parent,
  nextSibling: element => element.parent?.children[element.parent.children.indexOf(element) + 1] ?? null,
})
const apps: Vue.App[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount() })

const passthrough = Vue.defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) { return () => Vue.h('div', attrs, slots.default?.()) },
})
const dateField = Vue.defineComponent({
  props: ['modelValue', 'disabled', 'id'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => Vue.h('input', { id: props.id, value: props.modelValue, disabled: props.disabled, onInput: (value: string) => emit('update:modelValue', value) })
  },
})
const inlineConfirm = Vue.defineComponent({
  emits: ['confirm', 'cancel'],
  setup(_, { emit }) { return () => Vue.h('div', [Vue.h('button', { 'data-discard': true, onClick: () => emit('confirm') }), Vue.h('button', { 'data-keep': true, onClick: () => emit('cancel') })]) },
})
const unsavedChanges = Vue.defineComponent({
  props: ['dirty'],
  setup(props) { return () => Vue.h('div', { 'data-unsaved': props.dirty }) },
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const taskFixture = (id = 3): ScheduleTask => ({ id, name: `Task ${id}`, start: '2026-10-16', end: '2030-01-01', state: 'in_progress', dependency_ids: [], milestone_id: null })


// Run the production route guard with the real memory router. Only browser
// unload/focus hooks are omitted because this renderer has no DOM/window.
function loadUnsavedChanges(router: VueRouter.Router): Vue.Component {
  const filename = sharedFile('UnsavedChanges')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const compiled = compileScript(descriptor, { id: 'schedule-unsaved-changes', inlineTemplate: true }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/import\.meta\.client/g, 'false')
    .replace('export default', 'return')
  const code = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const bindings: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(Vue).filter(([name]) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)).map(([name, value]) => [`_${name}`, value])),
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    onMounted: () => {}, onBeforeUnmount: () => {},
    onBeforeRouteLeave: VueRouter.onBeforeRouteLeave, onBeforeRouteUpdate: VueRouter.onBeforeRouteUpdate,
    navigateTo: (destination: VueRouter.RouteLocationRaw) => router.push(destination),
  }
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings)) as Vue.Component
}

function harness(section = false, routing = false) {
  const task = taskFixture()
  const props = Vue.reactive({ projectId: 7, taskId: task.id, task, canWrite: true })
  const response = deferred<ScheduleTask>()
  const mutateAsync = vi.fn(() => response.promise)
  const pending = Vue.ref(false)
  const toast = vi.fn()
  const saved = vi.fn()
  const cancel = vi.fn()
  const schedule = { data: Vue.ref({ project_id: 7, tasks: [task, taskFixture(4)], milestones: [], can_manage: true, total: 2 }), error: Vue.ref<unknown>(null), isLoading: Vue.ref(false), refetch: vi.fn() }
  const project = { data: Vue.ref({ id: 7, active: true, date_start: null, date_end: null }), error: Vue.ref<unknown>(null), isLoading: Vue.ref(false), refetch: vi.fn() }
  const modules: Record<string, unknown> = {
    '@nasq/contracts': { ScheduleTaskPatchSchema },
    '@/composables/useProjectSchedule': { useUpdateProjectScheduleTask: () => ({ isPending: pending, mutateAsync }), useProjectSchedule: () => schedule },
    '@/composables/useProjects': { useProject: () => project },
    '@/composables/useApi': { ApiError },
    '@/utils/projectDateBounds': { validateTaskDates },
    '@nasq/ui/app/utils/errorState': { errorStateKind },
    '../../../utils/errorState': { errorStateKind },
    '@nasq/ui/app/composables/calendarDate': { formatCalendarDate },
  }
  const options = { modules, globals: { useToast: () => ({ add: toast }) } }
  const form = loadShared(resolve(import.meta.dirname, '../schedule/ScheduleTaskForm.vue'), options)
  modules['./ScheduleTaskForm.vue'] = { __esModule: true, default: form }
  const component = section ? loadShared(resolve(import.meta.dirname, '../schedule/ProjectTaskScheduleSection.vue'), options) : form
  const routeComponent = Vue.defineComponent({
    setup() {
      const route = VueRouter.useRoute()
      return () => Vue.h(component, { projectId: Number(route.params.id), taskId: Number(route.params.taskId) })
    },
  })
  const router = VueRouter.createRouter({ history: VueRouter.createMemoryHistory(), routes: [{ path: '/projects/:id/tasks/:taskId', component: routeComponent }] })
  const app = renderer.createApp({ render: () => routing ? Vue.h(VueRouter.RouterView) : Vue.h(component, section ? { projectId: props.projectId, taskId: props.taskId } : { projectId: props.projectId, task: props.task, canWrite: props.canWrite, onSaved: saved, onCancel: cancel }) })
  if (routing) app.use(router)
  for (const [name, stub] of Object.entries({
    ...DEFAULT_STUBS,
    UFormField: passthrough,
    SharedFormActions: passthrough,
    SharedDateField: dateField,
    SharedInlineConfirm: inlineConfirm,
    SharedUnsavedChanges: routing ? loadUnsavedChanges(router) : unsavedChanges,
    UModal: Vue.defineComponent({
      props: ['open', 'content'],
      setup(props, { slots }) { return () => props.open ? Vue.h('div', props.content, slots.footer?.()) : null },
    }),
    SharedRecordSection: loadShared('RecordSection', options),
    SharedPageState: loadShared('PageState', options),
  })) app.component(name, stub)
  const root = node()
  if (!routing) app.mount(root)
  app.config.globalProperties.$t = (key: string) => key
  apps.push(app)
  const mountRoute = async () => { await router.push('/projects/7/tasks/3'); await router.isReady(); app.mount(root) }
  function find(predicate: (element: HostNode) => boolean, current = root): HostNode | undefined {
    if (predicate(current)) return current
    for (const child of current.children) { const result = find(predicate, child); if (result) return result }
  }
  const input = () => find(element => element.props.id === 'planned-start')!
  const submit = () => find(element => element.type === 'form')!.props.onSubmit({ preventDefault() {} }) as Promise<void>
  const edit = async () => { find(element => element.props['data-testid'] === 'project-task-schedule-edit')!.props.onClick(); await Vue.nextTick() }
  return { props, response, mutateAsync, pending, toast, saved, cancel, schedule, project, root, find, input, submit, edit, router, mountRoute }
}

it('a pristine schedule cannot reset the time of an existing deadline', async () => {
  const html = await renderShared(resolve(import.meta.dirname, '../schedule/ScheduleTaskForm.vue'), {
    projectId: 7, task: taskFixture(),
  }, {}, {
    globals: { useRouter: () => ({}), useToast: () => ({ add: () => {} }) },
    modules: {
      '@nasq/contracts': { ScheduleTaskPatchSchema },
      '@/composables/useProjectSchedule': { useUpdateProjectScheduleTask: () => ({ isPending: Vue.ref(false) }) },
      '@/composables/useApi': { ApiError },
      '@/utils/projectDateBounds': { validateTaskDates },
    },
  })
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/)
})

describe('ScheduleTaskForm production behavior', () => {
  it('guards actual sibling task navigation and keeps dirty dates when choosing stay', async () => {
    const view = harness(true, true)
    await view.mountRoute()
    await view.edit()
    view.input().props.onInput('2026-10-17')
    await Vue.nextTick()
    const blocked = await view.router.push('/projects/7/tasks/4')
    expect(VueRouter.isNavigationFailure(blocked, VueRouter.NavigationFailureType.aborted)).toBe(true)
    expect(view.router.currentRoute.value.params.taskId).toBe('3')
    expect(view.find(element => element.props['data-testid'] === 'unsaved-changes-dialog')).toBeDefined()
    view.find(element => element.text === 'app.stay')!.parent!.props.onClick()
    await Vue.nextTick()
    expect(view.find(element => element.props['data-testid'] === 'unsaved-changes-dialog')).toBeUndefined()
    expect(view.input().props.value).toBe('2026-10-17')
    expect(view.router.currentRoute.value.params.taskId).toBe('3')
    expect(view.mutateAsync).not.toHaveBeenCalled()
  })

  it('blocks a stale date pair after a same-task refetch and requires confirmation before loading the latest pair', async () => {
    const view = harness()
    view.input().props.onInput('2026-10-17')
    view.props.task = { ...taskFixture(), end: '2030-01-02' }
    await Vue.nextTick()
    expect(view.input().props.value).toBe('2026-10-17')
    expect(view.find(element => element.props.id === 'planned-end')?.props.value).toBe('2030-01-01')
    expect(view.find(element => element.text === 'projects.schedule.changed')).toBeDefined()
    expect(view.find(element => element.props.type === 'submit')?.props.disabled).toBe(true)
    void view.submit()
    expect(view.mutateAsync).not.toHaveBeenCalled()
    view.find(element => element.text === 'projects.schedule.reload')!.parent!.props.onClick()
    await Vue.nextTick()
    expect(view.find(element => element.props['data-discard'])).toBeDefined()
    view.find(element => element.props['data-keep'])!.props.onClick()
    await Vue.nextTick()
    expect(view.input().props.value).toBe('2026-10-17')
    view.find(element => element.text === 'projects.schedule.reload')!.parent!.props.onClick()
    await Vue.nextTick()
    view.find(element => element.props['data-discard'])!.props.onClick()
    await Vue.nextTick()
    expect(view.input().props.value).toBe('2026-10-16')
    expect(view.find(element => element.props.id === 'planned-end')?.props.value).toBe('2030-01-02')
    expect(view.find(element => element.text === 'projects.schedule.changed')).toBeUndefined()
    expect(view.cancel).not.toHaveBeenCalled()
    view.input().props.onInput('2026-10-18')
    const saving = view.submit()
    expect(view.mutateAsync).toHaveBeenCalledWith({ projectId: 7, taskId: 3, patch: { start: '2026-10-18', end: '2030-01-02' } })
    view.response.resolve({ ...taskFixture(), start: '2026-10-18', end: '2030-01-02' })
    await saving
    expect(view.saved).toHaveBeenCalledTimes(1)
  })

  it('accepts its own confirmed save after cache refetch publishes the submitted dates', async () => {
    const view = harness()
    view.input().props.onInput('2026-10-17')
    const saving = view.submit()
    view.props.task = { ...taskFixture(), start: '2026-10-17' }
    await Vue.nextTick()
    view.response.resolve({ ...taskFixture(), start: '2026-10-17' })
    await saving
    expect(view.saved).toHaveBeenCalledTimes(1)
    expect(view.find(element => element.text === 'projects.schedule.changed')).toBeUndefined()
    expect(view.find(element => element.props['data-unsaved'] === true)).toBeUndefined()
  })

  it('retains the draft if a different server date pair arrives while saving', async () => {
    const view = harness()
    view.input().props.onInput('2026-10-17')
    const saving = view.submit()
    view.props.task = { ...taskFixture(), end: '2030-01-02' }
    await Vue.nextTick()
    view.response.resolve({ ...taskFixture(), start: '2026-10-17' })
    await saving
    expect(view.saved).not.toHaveBeenCalled()
    expect(view.toast).not.toHaveBeenCalled()
    expect(view.input().props.value).toBe('2026-10-17')
    expect(view.find(element => element.text === 'projects.schedule.changed')).toBeDefined()
    expect(view.find(element => element.props['data-unsaved'] === true)).toBeDefined()
  })

  it('loads a changed server pair directly when there is no local draft to discard', async () => {
    const view = harness()
    view.props.task = { ...taskFixture(), end: '2030-01-02' }
    await Vue.nextTick()
    view.find(element => element.text === 'projects.schedule.reload')!.parent!.props.onClick()
    await Vue.nextTick()
    expect(view.find(element => element.props['data-discard'])).toBeUndefined()
    expect(view.find(element => element.props.id === 'planned-end')?.props.value).toBe('2030-01-02')
    expect(view.find(element => element.text === 'projects.schedule.changed')).toBeUndefined()
    expect(view.mutateAsync).not.toHaveBeenCalled()
  })

  it('does not conflict when a same-task refetch has the same dates', async () => {
    const view = harness()
    view.input().props.onInput('2026-10-17')
    view.props.task = { ...taskFixture(), name: 'Updated task name' }
    await Vue.nextTick()
    expect(view.find(element => element.text === 'projects.schedule.changed')).toBeUndefined()
    expect(view.input().props.disabled).toBe(false)
    const saving = view.submit()
    expect(view.mutateAsync).toHaveBeenCalledTimes(1)
    view.response.resolve({ ...taskFixture(), start: '2026-10-17' })
    await saving
    expect(view.saved).toHaveBeenCalledTimes(1)
  })

  it('preserves a dirty draft read-only when project management permission is revoked', async () => {
    const view = harness(true)
    await view.edit()
    view.input().props.onInput('2026-10-17')
    await Vue.nextTick()
    view.schedule.data.value.can_manage = false
    await Vue.nextTick()
    expect(view.input()?.props.value).toBe('2026-10-17')
    expect(view.input().props.disabled).toBe(true)
    expect(view.find(element => element.text === 'projects.schedule.readOnly')).toBeDefined()
    expect(view.find(element => element.props['data-unsaved'] === true)).toBeDefined()
    view.input().props.onInput('2026-10-18')
    await view.submit()
    expect(view.input().props.value).toBe('2026-10-17')
    expect(view.mutateAsync).not.toHaveBeenCalled()
    view.schedule.data.value.can_manage = true
    await Vue.nextTick()
    expect(view.input().props.value).toBe('2026-10-17')
    expect(view.input().props.disabled).toBe(false)
  })

  it('blocks rapid duplicate saves and field changes until the response, then reports success', async () => {
    const view = harness()
    view.input().props.onInput('2026-10-17')
    const first = view.submit()
    const second = view.submit()
    await Vue.nextTick()
    expect(view.mutateAsync).toHaveBeenCalledTimes(1)
    expect(view.mutateAsync).toHaveBeenCalledWith({ projectId: 7, taskId: 3, patch: { start: '2026-10-17', end: '2030-01-01' } })
    expect(view.input().props.disabled).toBe(true)
    await view.find(element => element.type === 'button' && element.props.type === 'button')!.props.onClick()
    expect(view.cancel).not.toHaveBeenCalled()
    expect(view.find(element => element.props['data-discard'])).toBeUndefined()
    view.input().props.onInput('2026-10-18')
    expect(view.toast).not.toHaveBeenCalled()
    expect(view.saved).not.toHaveBeenCalled()
    view.response.resolve({ ...taskFixture(), start: '2026-10-17' })
    await Promise.all([first, second])
    expect(view.input().props.value).toBe('2026-10-17')
    expect(view.saved).toHaveBeenCalledTimes(1)
    expect(view.toast).toHaveBeenCalledTimes(1)
    expect(view.find(element => element.props.type === 'submit')?.props.disabled).toBe(true)
  })

  it('retains edited dates and the route-leave dirty guard after a failed save', async () => {
    const view = harness()
    view.input().props.onInput('2026-10-17')
    const saving = view.submit()
    view.response.reject(new ApiError(422, 'invalid', 'Deadline is invalid'))
    await saving
    expect(view.input().props.value).toBe('2026-10-17')
    expect(view.find(element => element.props['data-unsaved'] === true)).toBeDefined()
    expect(view.find(element => element.props.role === 'alert')?.children[0]?.text).toBe('Deadline is invalid')
    expect(view.toast).not.toHaveBeenCalled()
    expect(view.saved).not.toHaveBeenCalled()
  })

  it.each(['task', 'project'] as const)('resets draft and ignores a late save result when the %s identity changes', async (identity) => {
    const view = harness()
    view.input().props.onInput('2026-10-17')
    const saving = view.submit()
    if (identity === 'task') view.props.task = { ...taskFixture(4), start: '2026-11-01' }
    else view.props.projectId = 8
    await Vue.nextTick()
    expect(view.input().props.value).toBe(identity === 'task' ? '2026-11-01' : '2026-10-16')
    expect(view.find(element => element.props['data-unsaved'] === true)).toBeUndefined()
    view.response.resolve({ ...taskFixture(), start: '2026-10-17' })
    await saving
    expect(view.saved).not.toHaveBeenCalled()
    expect(view.toast).not.toHaveBeenCalled()
  })

  it('asks inline before cancellation and blocks saves until the draft decision is resolved', async () => {
    const view = harness()
    view.input().props.onInput('2026-10-17')
    await view.find(element => element.type === 'button' && element.props.type === 'button')!.props.onClick()
    await Vue.nextTick()
    expect(view.cancel).not.toHaveBeenCalled()
    expect(view.find(element => element.props['data-discard'])).toBeDefined()
    void view.submit()
    expect(view.mutateAsync).not.toHaveBeenCalled()
    await view.find(element => element.props['data-discard'])!.props.onClick()
    await Vue.nextTick()
    expect(view.cancel).toHaveBeenCalledTimes(1)
    expect(view.find(element => element.props['data-unsaved'] === true)).toBeUndefined()
  })

  it('keeps the dirty form across a transient read failure and recovery', async () => {
    const view = harness(true)
    await view.edit()
    view.input().props.onInput('2026-10-17')
    view.schedule.error.value = new ApiError(503, 'unavailable', 'Try again')
    await Vue.nextTick()
    expect(view.input()?.props.value).toBe('2026-10-17')
    expect(view.find(element => element.props['data-unsaved'] === true)).toBeDefined()
    view.schedule.error.value = null
    await Vue.nextTick()
    expect(view.input().props.value).toBe('2026-10-17')
  })

  it.each([403, 404])('hides the draft when a cached read is denied with %s', async (status) => {
    const view = harness(true)
    await view.edit()
    view.input().props.onInput('2026-10-17')
    view.schedule.error.value = new ApiError(status, status === 403 ? 'forbidden' : 'not_found', 'Unavailable')
    await Vue.nextTick()
    expect(Boolean(view.input())).toBe(false)
    expect(view.find(element => element.type === 'form')).toBeUndefined()
  })

  it('ignores a response after the schedule section has unmounted its form', async () => {
    const view = harness(true)
    await view.edit()
    view.input().props.onInput('2026-10-17')
    const saving = view.submit()
    view.props.projectId = 8
    await Vue.nextTick()
    view.response.resolve({ ...taskFixture(), start: '2026-10-17' })
    await saving
    expect(view.toast).not.toHaveBeenCalled()
    expect(Boolean(view.input())).toBe(false)
  })

  it('closes editing when the project changes even if its task id is reused', async () => {
    const view = harness(true)
    await view.edit()
    view.input().props.onInput('2026-10-17')
    view.props.projectId = 8
    await Vue.nextTick()
    expect(Boolean(view.input())).toBe(false)
  })
})
