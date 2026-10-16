import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import type { ProjectDetail, ProjectPatch } from '@webvue/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import * as VueRouter from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'
import { sharedFile } from '@webvue/ui/test/helpers/renderShared'
import { saveErrorMessage } from '../../../../utils/formFeedback'

interface HostNode {
  type: string
  children: HostNode[]
  parent: HostNode | null
  props: Record<string, unknown>
  text: string
}
const node = (type = 'root', text = ''): HostNode => ({ type, text, children: [], parent: null, props: {} })
const renderer = Vue.createRenderer<HostNode, HostNode>({
  patchProp: (el, key, _old, value) => { el.props[key] = value },
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
  },
  remove(child) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  },
  createElement: type => node(type), createText: text => node('text', text), createComment: text => node('comment', text),
  setText: (el, text) => { el.text = text },
  setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent,
  nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
})
function nodes(root: HostNode): HostNode[] { return [root, ...root.children.flatMap(nodes)] }
function text(root: HostNode): string { return root.text + root.children.map(text).join('') }

const stub = Vue.defineComponent({
  inheritAttrs: false, props: ['modelValue'],
  setup(props, { attrs, slots }) { return () => Vue.h('control', { ...attrs, modelValue: props.modelValue }, [String(attrs.label ?? ''), String(attrs.title ?? ''), slots.default?.(), slots.actions?.()]) },
})
const tagPicker = Vue.defineComponent({
  inheritAttrs: false, props: ['modelValue'],
  setup(props, { attrs }) { return () => Vue.h('control', { ...attrs, modelValue: props.modelValue, 'data-testid': 'tag-picker' }) },
})
function loadComponent(path: string, bindings: Record<string, unknown>): Vue.Component {
  const descriptor = parse(readFileSync(path, 'utf8'), { filename: path }).descriptor
  const compiled = compileScript(descriptor, { id: 'project-settings-behavior', inlineTemplate: true }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/import\.meta\.client/g, 'false')
    .replace('export default', 'return')
  const code = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const globals = {
    ...Vue,
    ...Object.fromEntries(Object.entries(Vue).map(([key, value]) => [`_${key}`, value])),
    ...bindings,
  }
  return new Function(...Object.keys(globals), code)(...Object.values(globals)) as Vue.Component
}
const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../ProjectGeneralForm.vue')
const initial = {
  id: 4, name: 'Portal', privacy_visibility: 'employees', allow_task_dependencies: false,
  can_manage: true, tags: [], completion_approval: 'none', completion_approver: null,
} as unknown as ProjectDetail
interface Request {
  variables: { id: number; patch: ProjectPatch }
  callbacks: { onSuccess?: (detail: ProjectDetail) => void; onError?: (error: unknown) => void; onSettled?: () => void }
}
const apps: Vue.App[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount() })

async function mountForm() {
  const project = Vue.ref<ProjectDetail>({ ...initial })
  const people = Vue.ref([{ id: 9, name: 'Noura' }])
  const requests: Request[] = []
  const isPending = Vue.ref(false)
  const isError = Vue.ref(false)
  const isSuccess = Vue.ref(false)
  const UnsavedChanges = loadComponent(sharedFile('UnsavedChanges'), {
    onBeforeRouteLeave: VueRouter.onBeforeRouteLeave, onBeforeRouteUpdate: VueRouter.onBeforeRouteUpdate,
    onMounted: () => {}, onBeforeUnmount: () => {}, navigateTo: (path: string) => router.push(path),
  })
  const Form = loadComponent(filename, {
    TagPicker: tagPicker, refDebounced: (value: unknown) => value,
    saveErrorMessage,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useToast: () => ({ add: () => {} }), usePeople: () => ({ data: people }),
    useUpdateProject: () => ({
      isPending, isError, isSuccess,
      mutate: (variables: Request['variables'], callbacks: Request['callbacks']) => {
        isPending.value = true; isError.value = false; isSuccess.value = false
        requests.push({ variables, callbacks })
      },
    }),
  })
  const router = VueRouter.createRouter({ history: VueRouter.createMemoryHistory(), routes: [
    { path: '/projects/:id/settings', component: Vue.defineComponent({ setup: () => () => Vue.h(Form, { project: project.value }) }) },
    { path: '/projects', component: Vue.defineComponent({ render: () => Vue.h('div', 'Projects') }) },
  ] })
  await router.push('/projects/4/settings')
  const app = renderer.createApp({ render: () => Vue.h(VueRouter.RouterView) })
  for (const name of ['USelect', 'USelectMenu', 'USwitch', 'UButton', 'UFormField', 'USeparator', 'UAlert']) app.component(name, stub)
  app.component('SharedUnsavedChanges', UnsavedChanges)
  app.component('UModal', Vue.defineComponent({
    props: ['open', 'content'], setup: (props, { slots }) => () => props.open ? Vue.h('modal', props.content, slots.footer?.()) : null,
  }))
  app.config.globalProperties.$t = (key: string) => key
  app.use(router)
  const host = node()
  app.mount(host)
  apps.push(app)
  const find = (testId: string) => nodes(host).find(el => el.props['data-testid'] === testId || el.props.id === testId)
  const control = (testId: string) => {
    const el = find(testId)
    if (!el) throw new Error(`Missing ${testId}`)
    return el
  }
  async function change(testId: string, value: unknown) {
    const el = control(testId)
    ;(el.props['onUpdate:modelValue'] as (value: unknown) => void)(value)
    await Vue.nextTick()
  }
  async function click(testId: string) {
    ;(control(testId).props.onClick as () => void)()
    await Vue.nextTick()
  }
  async function settle(error?: unknown) {
    const request = requests.at(-1)!
    isPending.value = false
    isError.value = !!error
    isSuccess.value = !error
    if (error) request.callbacks.onError?.(error)
    else request.callbacks.onSuccess?.(project.value)
    request.callbacks.onSettled?.()
    await Vue.nextTick()
  }
  return { project, people, requests, router, host, find, control, change, click, settle }
}

describe('ProjectGeneralForm autosave and draft behavior', () => {
  it('protects an incomplete approver selection on leave and preserves it through a server refresh', async () => {
    const form = await mountForm()
    await form.change('project-approval-mode', 'specific_user')
    expect(form.requests).toHaveLength(0)
    expect(text(form.control('project-autosave-status'))).toBe('projects.clarity.chooseApprover')
    expect(await form.router.push('/projects')).toBeTruthy()
    expect(form.router.currentRoute.value.path).toBe('/projects/4/settings')
    expect(await form.router.push('/projects/5/settings')).toBeTruthy()
    expect(form.router.currentRoute.value.path).toBe('/projects/4/settings')
    const stay = nodes(form.host).find(el => text(el) === 'app.stay' && el.props.onClick)
    expect(stay).toBeTruthy()
    ;(stay!.props.onClick as () => void)()
    form.project.value = { ...form.project.value, completion_approval: 'project_manager' }
    await Vue.nextTick()
    expect(form.control('project-approval-mode').props.modelValue).toBe('specific_user')
    await form.click('project-approval-cancel')
    expect(await form.router.push('/projects')).toBeUndefined()
  })

  it('preserves pending and failed visibility intent, prevents overlapping writes, and retries the same patch', async () => {
    const form = await mountForm()
    await form.change('project-settings-visibility', 'followers')
    expect(form.requests[0]?.variables).toEqual({ id: 4, patch: { privacy_visibility: 'followers' } })
    expect(text(form.control('project-autosave-status'))).toBe('projects.clarity.saving')
    expect(nodes(form.host).find(el => el.type === 'fieldset')?.props.disabled).toBe(true)
    expect(form.control('project-settings-visibility').props.modelValue).toBe('followers')
    expect(await form.router.push('/projects')).toBeTruthy()
    const dependency = nodes(form.host).find(el => el.props['aria-label'] === 'taskLifecycle.enableDependencies')!
    ;(dependency.props['onUpdate:modelValue'] as (value: boolean) => void)(true)
    expect(form.requests).toHaveLength(1)
    await form.settle({ status: 0, message: 'Disconnected' })
    expect(text(form.host)).toContain('errors.saveUncertain')
    expect(text(form.control('project-autosave-status'))).toBe('projects.clarity.saveFailed')
    expect(form.control('project-settings-visibility').props.modelValue).toBe('followers')
    expect(await form.router.push('/projects')).toBeTruthy()
    await form.click('project-settings-retry')
    expect(form.requests).toHaveLength(2)
    expect(form.requests[1]?.variables).toEqual(form.requests[0]?.variables)
    form.project.value = { ...form.project.value, privacy_visibility: 'followers' }
    await form.settle()
    expect(text(form.control('project-autosave-status'))).toBe('projects.clarity.saved')
    expect(await form.router.push('/projects')).toBeUndefined()
  })

  it('keeps a failed approver and its label after the picker search changes, then retries the atomic approval patch', async () => {
    const form = await mountForm()
    await form.change('project-approval-mode', 'specific_user')
    await form.change('project-approver', 9)
    await form.settle({ status: 422, message: 'Select an eligible approver' })
    form.people.value = []
    form.project.value = { ...form.project.value, completion_approval: 'project_manager' }
    await Vue.nextTick()
    expect(form.control('project-approval-mode').props.modelValue).toBe('specific_user')
    expect(form.control('project-approver').props.modelValue).toBe(9)
    expect(text(form.control('project-approver'))).toBe('Noura')
    expect(await form.router.push('/projects')).toBeTruthy()
    await form.click('project-settings-retry')
    expect(form.requests[1]?.variables.patch).toEqual({ webvue_completion_approval: 'specific_user', webvue_completion_approver_id: 9 })
    form.project.value = { ...form.project.value, completion_approval: 'specific_user', completion_approver: { id: 9, name: 'Noura' } }
    await form.settle()
    expect(await form.router.push('/projects')).toBeUndefined()
  })

  it('keeps an incomplete approval draft after an unrelated autosave succeeds', async () => {
    const form = await mountForm()
    await form.change('project-approval-mode', 'specific_user')
    await form.change('project-settings-visibility', 'followers')
    form.project.value = { ...form.project.value, privacy_visibility: 'followers' }
    await form.settle()
    expect(form.control('project-approval-mode').props.modelValue).toBe('specific_user')
    expect(text(form.control('project-autosave-status'))).toBe('projects.clarity.chooseApprover')
    expect(await form.router.push('/projects')).toBeTruthy()
  })

  it('preserves failed tags as resolved values and retries only their ids', async () => {
    const form = await mountForm()
    const tags = [{ id: 3, name: 'Design', color: 1 }]
    await form.change('tag-picker', { ids: [3], resolved: tags })
    await form.settle({ status: 403, message: 'Permission changed' })
    expect(form.control('tag-picker').props.modelValue).toEqual(tags)
    await form.click('project-settings-retry')
    expect(form.requests[1]?.variables.patch).toEqual({ tag_ids: [3] })
  })
})
