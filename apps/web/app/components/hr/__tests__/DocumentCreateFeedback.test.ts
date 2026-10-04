import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

const shared = 'components/hr/DocumentCreateForm.vue'
const pages = ['pages/hr/documents/new.vue', 'pages/hr/departments/[departmentId]/documents/new.vue']
async function load(file = shared, allowed = true, selected = true) {
  const root = resolve(import.meta.dirname, '../../..'), filename = resolve(root, file)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'document-create-feedback' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const messages = JSON.parse(readFileSync(resolve(root, '../i18n/locales/ar/hr.json'), 'utf8'))
  const t = (key: string) => key.split('.').reduce((o: any, key) => o?.[key], messages) ?? key
  const mutate = vi.fn(async (_data: any) => ({ id: 9 }))
  const pending = Vue.ref(false), hydrated = Vue.ref(true), emit = vi.fn(), navigate = vi.fn()
  const props = { departmentId: 4, backTo: { path: '/hr/departments/4', query: { returnTo: '/hr/departments?view=canvas#chart' } } }
  const bindings = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, nextTick: Vue.nextTick,
    useI18n: () => ({ t }), useHydrated: () => hydrated, useToast: () => ({ add: vi.fn() }), useAccess: () => ({ can: () => allowed }),
    useRoute: () => ({ params: { departmentId: '4' }, query: { department_id: selected ? '4' : undefined, returnTo: '/hr/departments/4?returnTo=%2Fhr%2Fdepartments%3Fview%3Dcanvas%23chart' }, hash: '' }),
    useCreateDocument: () => ({ mutateAsync: mutate, isPending: pending }),
    useHrDepartments: () => ({ data: Vue.ref({ items: [{ id: 4, name: 'Department' }] }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
    navigateTo: navigate, ApiError: class extends Error {}, DocumentEditor: {}, DocumentCreateForm: {},
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const state = component.setup(props, { expose: () => {}, emit })
  const compiled = compileTemplate({ source: descriptor.template!.content, filename, id: 'document-create-feedback', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(compiled.code))(Vue)
  async function rendered() {
    const nodes: { name: string, props: Record<string, any> }[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...props, ...Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))) }), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]!))) app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
      return () => { nodes.push({ name, props: { ...attrs } }); return Vue.h('div', [slots.default?.(), slots.header?.()]) }
    } }))
    await renderToString(app)
    return nodes
  }
  return { state, pending, hydrated, mutate, emit, navigate, props, rendered }
}
async function titleError(view: Awaited<ReturnType<typeof load>>) { return (await view.rendered()).find(n => n.name === 'UFormField' && n.props.name === 'hr-doc-new-name')!.props.error }

it('allows first blank submit with Arabic title feedback, clears correction, and preserves failed-save draft and success payload', async () => {
  const view = await load()
  const button = (await view.rendered()).find(n => n.name === 'UButton' && n.props.type === 'submit')!
  expect(button.props.disabled).toBe(false)
  expect(await titleError(view)).toBeUndefined()
  await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
  expect(await titleError(view)).toBe('عنوان المستند مطلوب.')
  view.state.name.value = ' '; view.state.body.value = '<p>Draft</p>'
  await view.state.submit(); expect(view.mutate).not.toHaveBeenCalled()
  expect(view.state.saved.value).toBe(false); expect(view.state.dirty.value).toBe(true)
  view.state.name.value = ' Document '
  expect(await titleError(view)).toBeUndefined()
  view.mutate.mockRejectedValueOnce(new Error('offline'))
  await view.state.submit()
  expect(view.state.dirty.value).toBe(true); expect(view.emit).not.toHaveBeenCalled()
  const nodes = await view.rendered()
  expect(nodes.findIndex(n => n.name === 'UAlert')).toBeGreaterThanOrEqual(0)
  expect(nodes.findIndex(n => n.name === 'UAlert')).toBeLessThan(nodes.findIndex(n => n.name === 'UFormField'))
  await view.state.submit()
  expect(view.mutate.mock.calls[1]![0]).toEqual({ name: 'Document', body: '<p>Draft</p>', department_id: 4 })
  expect(view.emit).toHaveBeenCalledExactlyOnceWith('saved', 9)
  expect(view.state.saved.value).toBe(true); expect(view.state.dirty.value).toBe(false)
})
it('blocks unhydrated/pending creation and retains Cancel destination', async () => {
  const view = await load(); view.state.name.value = 'Document'
  view.hydrated.value = false; await view.state.submit()
  view.hydrated.value = true; view.pending.value = true; await view.state.submit()
  expect(view.mutate).not.toHaveBeenCalled(); expect(view.state.dirty.value).toBe(true)
  const nodes = await view.rendered()
  expect(nodes.find(n => n.name === 'UButton' && n.props.type === 'submit')!.props.loading).toBe(true)
  expect(nodes.find(n => n.name === 'UButton' && n.props.type === 'button')!.props.to).toEqual(view.props.backTo)
})
it.each(pages)('%s uses the repaired shared form behind existing capability gate', async file => {
  const allowed = await load(file)
  const form = (await allowed.rendered()).find(n => n.name === 'DocumentCreateForm')
  expect(form?.props['department-id']).toBe(4)
  expect(form?.props['back-to']).toEqual(allowed.state.backTo.value)
  const denied = await load(file, false)
  expect((await denied.rendered()).some(n => n.name === 'DocumentCreateForm')).toBe(false)
})
it('generic document create waits for a real selected department', async () => {
  const view = await load(pages[0], true, false)
  expect((await view.rendered()).some(n => n.name === 'DocumentCreateForm')).toBe(false)
})
