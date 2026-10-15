import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { isDirtySnapshot } from '../../../../lib/formDirty'
import { validateMilestoneDates, validateTaskDates } from '../../../../utils/projectDateBounds'
import { buildTaskCreatePayload, plainTextToTaskHtml, validateTaskCreatePolicy } from '../../../../utils/taskCreatePolicy'
import { buildMilestonePatch } from '../../../../utils/milestonePayload'

const forms = [
  { file: 'components/pmo/projects/MilestoneForm.vue', field: 'name', label: 'projects.milestones.name' },
  { file: 'components/pmo/projects/ProjectUpdateForm.vue', field: 'title', label: 'projects.updates.title' },
  { file: 'components/pmo/projects/governance/StakeholderForm.vue', field: 'name', label: 'projects.governance.stakeholder.name' },
  { file: 'components/pmo/projects/governance/RegisterForm.vue', field: 'title', label: 'projects.governance.register.itemTitle' },
]
const taskFile = 'components/pmo/tasks/TaskCreateForm.vue'
async function load(file: string, locale = 'ar', props: Record<string, unknown> = {}) {
  const appRoot = resolve(import.meta.dirname, '../../../..')
  const filename = resolve(appRoot, file)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'required-feedback' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const messages = JSON.parse(readFileSync(resolve(appRoot, `../i18n/locales/${locale}/projects.json`), 'utf8'))
  Object.assign(messages, JSON.parse(readFileSync(resolve(appRoot, `../i18n/locales/${locale}/tasks.json`), 'utf8')))
  const t = (key: string) => key.split('.').reduce((value: any, part) => value?.[part], messages) ?? key
  const mutate = vi.fn(async (_body: any) => ({ id: 9 }))
  const update = vi.fn(async (_body: any) => ({ id: 9 }))
  const pending = Vue.ref(false), hydrated = Vue.ref(true), mutationError = Vue.ref<unknown>(null)
  const projectList = Vue.ref([{ id: 7, name: 'Project' }])
  const projectData = Vue.ref({ id: 7, date_start: '2030-01-01', date_end: '2030-12-31', can_manage: true })
  const milestoneData = Vue.ref<any[]>([])
  const projectLoading = Vue.ref(false)
  const mutation = { mutateAsync: mutate, isPending: pending, error: mutationError }
  const push = vi.fn()
  const bindings = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, nextTick: Vue.nextTick,
    useHydrated: () => hydrated, useI18n: () => ({ t }), useToast: () => ({ add: vi.fn() }),
    useRoute: () => ({ params: { id: '2' } }), useRouter: () => ({ push }),
    useProjects: () => ({ data: projectList }), useProject: () => ({ data: projectData, isLoading: projectLoading, error: Vue.ref(null) }),
    useMilestones: () => ({ data: milestoneData, isLoading: Vue.ref(false), error: Vue.ref(null) }), useCreateTask: () => mutation,
    useCreateMilestone: () => mutation, useUpdateMilestone: () => ({ ...mutation, mutateAsync: update }),
    useCreateProjectUpdate: () => mutation, useCreateProjectStakeholder: () => mutation, useUpdateProjectStakeholder: () => ({ ...mutation, mutateAsync: update }),
    useCreateProjectRegister: () => mutation, useUpdateProjectRegister: () => ({ ...mutation, mutateAsync: update }),
    usePeople: () => ({ data: Vue.ref([]), isLoading: Vue.ref(false), error: Vue.ref(null) }),
    useTasks: () => ({ data: Vue.ref({ pages: [] }), isLoading: Vue.ref(false), error: Vue.ref(null), hasNextPage: Vue.ref(false) }),
    useSsrQuerySeed: () => {}, isDirtySnapshot, validateMilestoneDates, buildMilestonePatch, validateTaskDates, buildTaskCreatePayload, plainTextToTaskHtml, validateTaskCreatePolicy,
    ApiError: class extends Error {}, DescriptionEditor: {},
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope(), emit = vi.fn()
  const inputProps = { item: undefined, milestone: undefined, stakeholder: undefined, projectId: 7, projectStart: '2030-01-01', projectEnd: '2030-12-31', ...props }
  const state = scope.run(() => component.setup(inputProps, { expose: () => {}, emit }))
  const compiled = compileTemplate({ source: descriptor.template!.content, filename, id: 'required-feedback', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(compiled.code))(Vue)
  async function rendered() {
    const nodes: { name: string, props: Record<string, any> }[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...inputProps, ...Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))) }), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]!))) app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
      return () => { nodes.push({ name, props: { ...attrs } }); return Vue.h('div', [slots.default?.(), slots.header?.(), slots.actions?.(), slots.hint?.()]) }
    } }))
    const html = await renderToString(app)
    return { nodes, html }
  }
  return { state, mutate, update, emit, pending, hydrated, mutationError, push, projectList, projectData, milestoneData, projectLoading, rendered, t, stop: () => scope.stop() }
}
async function fieldError(view: Awaited<ReturnType<typeof load>>, label: string) { return (await view.rendered()).nodes.find(node => node.name === 'UFormField' && node.props.label === view.t(label))?.props.error }
async function submitButton(view: Awaited<ReturnType<typeof load>>) { return (await view.rendered()).nodes.find(node => node.name === 'UButton' && node.props.type === 'submit')!.props }

describe('required PMO form feedback', () => {
  it.each(forms)('$file accepts an invalid first attempt, reports translated field error and preserves dirty/server failure handling', async ({ file, field, label }) => {
    const view = await load(file)
    expect((await submitButton(view)).disabled).toBe(false)
    expect((await view.rendered()).html).toMatch(/<form[^>]*novalidate/)
    expect(await fieldError(view, label)).toBeUndefined()
    view.state[field].value = '   '
    await view.state.submit()
    expect(view.mutate).not.toHaveBeenCalled()
    expect(await fieldError(view, label)).toMatch(/[\u0600-\u06ff]/)
    expect(view.state.dirty.value).toBe(true)
    view.state[field].value = '  Valid  '
    expect(await fieldError(view, label)).toBeUndefined()
    if (view.state.startDate) { view.state.startDate.value = '2030-02-01'; view.state.deadline.value = '2030-03-01' }
    view.mutate.mockRejectedValueOnce(new Error('offline'))
    await view.state.submit()
    expect(view.state.dirty.value).toBe(true)
    expect((await view.rendered()).nodes.some(node => node.name === 'UAlert')).toBe(true)
    await view.state.submit()
    const input = view.mutate.mock.calls[1]![0]
    expect(input.body?.name ?? input.body?.title ?? input.name).toBe('Valid')
    expect(view.state.dirty.value).toBe(false)
    expect(view.emit.mock.calls.some(call => call[0] === 'saved')).toBe(true)
    view.stop()
  })
  it.each(forms)('$file blocks pending/unhydrated submissions without changing the draft', async ({ file, field }) => {
    const view = await load(file, 'en')
    view.state[field].value = 'Valid'
    view.pending.value = true
    expect((await submitButton(view)).loading).toBe(true)
    await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
    view.pending.value = false; view.hydrated.value = false
    await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
    expect(view.state.dirty.value).toBe(true)
    view.stop()
  })
  it.each([
    { ...forms[0]!, props: { milestone: { id: 9, name: 'Existing', start_date: '2030-02-01', deadline: '2030-03-01', deliverables: [] } } },
    { ...forms[2]!, props: { stakeholder: { id: 9, name: 'Existing' } } },
    { ...forms[3]!, props: { item: { id: 9, title: 'Existing', kind: 'issue' } } },
  ])('$file keeps the edit mutation and identifier after correcting a blank field', async ({ file, field, label, props }) => {
    const view = await load(file, 'en', props)
    view.state[field].value = ' '
    await view.state.submit()
    expect(view.update).not.toHaveBeenCalled(); expect(await fieldError(view, label)).toBeTruthy()
    view.state[field].value = ' Updated '
    await view.state.submit()
    expect(view.mutate).not.toHaveBeenCalled()
    expect(view.update).toHaveBeenCalledWith(expect.objectContaining({ projectId: 7, id: 9 }))
    const input = view.update.mock.calls[0]![0]
    expect(input.patch?.name ?? input.body?.name ?? input.body?.title).toBe('Updated')
    if (file.includes('RegisterForm')) { expect(input.body.kind).toBe('issue'); expect(input.body).not.toHaveProperty('probability') }
    expect(view.state.dirty.value).toBe(false)
    view.stop()
  })
  it('retains milestone schedule validation after correcting the required name', async () => {
    const view = await load(forms[0]!.file)
    view.state.name.value = 'Milestone'
    await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
    expect(view.state.error.value).toBe(view.t('projects.milestones.scheduleRequired'))
    view.state.startDate.value = '2029-01-01'; view.state.deadline.value = '2030-02-01'
    await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
    expect(view.state.error.value).toBe(view.t('projects.milestones.startOutsideProject'))
    view.stop()
  })
  it('task creation reports missing name and project after submit, clears corrections and retains payload/dirty rules', async () => {
    const view = await load(taskFile, 'ar', { projectId: undefined, mode: 'project' })
    expect(view.state.selectedProjectId.value).toBe(7)
    expect((await submitButton(view)).disabled).toBe(false)
    expect((await view.rendered()).html).toMatch(/<form[^>]*novalidate/)
    expect(await fieldError(view, 'tasks.newTitle')).toBeUndefined()
    view.state.name.value = ' '
    await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
    expect(await fieldError(view, 'tasks.newTitle')).toMatch(/[\u0600-\u06ff]/)
    expect(view.state.submitted.value).toBe(false); expect(view.state.dirty.value).toBe(true)
    view.state.name.value = ' Task '
    expect(await fieldError(view, 'tasks.newTitle')).toBeUndefined()
    view.projectList.value = []; view.state.selectProject(undefined)
    expect((await submitButton(view)).disabled).toBe(false)
    await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
    expect(await fieldError(view, 'tasks.project')).toMatch(/[\u0600-\u06ff]/)
    view.state.selectProject(7)
    expect(await fieldError(view, 'tasks.project')).toBeUndefined()
    view.state.description.value = '<b>literal</b>'
    view.mutate.mockRejectedValueOnce(new Error('offline'))
    await view.state.submit(); expect(view.state.dirty.value).toBe(true)
    expect((await view.rendered()).nodes.some(node => node.name === 'UAlert')).toBe(true)
    await view.state.submit()
    expect(view.mutate.mock.calls[1]![0]).toMatchObject({ name: 'Task', project_id: 7, description: '&lt;b&gt;literal&lt;/b&gt;' })
    expect(view.mutate.mock.calls[1]![0]).not.toHaveProperty('user_ids')
    expect(view.emit).toHaveBeenCalledWith('created', 9); expect(view.state.dirty.value).toBe(false)
    view.stop()
  })
  it('task creation retains hydration, pending, project readiness, guided schedule and date checks', async () => {
    const view = await load(taskFile)
    view.state.name.value = 'Task'
    view.hydrated.value = false; await view.state.submit()
    view.hydrated.value = true; view.pending.value = true; await view.state.submit()
    expect(view.mutate).not.toHaveBeenCalled()
    view.pending.value = false; view.projectLoading.value = true
    await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
    view.projectLoading.value = false
    view.milestoneData.value = [{ id: 2, name: 'Milestone', start_date: '2030-02-01', deadline: '2030-03-01' }]
    await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
    expect(view.state.errorField.value).toBe('milestone_id')
    view.state.selectedMilestoneId.value = 2
    await view.state.submit(); expect(view.state.errorField.value).toBe('planned_start')
    view.state.plannedStart.value = '2029-01-01'; view.state.dateDeadline.value = '2030-03-01'
    await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
    expect(view.state.errorField.value).toBe('planned_start')
    view.stop()
  })
})
