import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { ApiError } from '../../../composables/useApi'
import { getAllowedParentIds } from '../../../lib/departmentTree'
import { hrManagerOptions } from '../../../composables/useHrEmployees'

const root = resolve(import.meta.dirname, '../../..')
const forms = ['EmployeeGeneralForm.vue', 'DepartmentForm.vue']
async function load(file: string) {
  const filename = resolve(root, 'components/hr', file)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'hr-save-feedback' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const messages = JSON.parse(readFileSync(resolve(root, '../i18n/locales/ar/hr.json'), 'utf8'))
  const t = (key: string) => key.split('.').reduce((value: any, key) => value?.[key], messages) ?? key
  const employee = { id: 9, name: 'مسودة', job_title: '', department: null, work_email: 'draft@example.test', work_phone: '', user_id: null, manager: null, active: true, access: null }
  const department = { id: 9, name: 'مسودة', parent_id: null, manager: null, child_ids: [], employee_count: 0 }
  const result = file.startsWith('Employee') ? employee : department
  const mutation = vi.fn(async (_data: unknown) => result)
  const toast = vi.fn(), emit = vi.fn()
  const pending = Vue.ref(false)
  const mutationHook = () => ({ mutateAsync: mutation, isPending: pending })
  const list = () => ({ data: Vue.ref({ items: [], total: 0 }), isFetching: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() })
  const props = { departments: [], employees: [], employee: null, department: null }
  const bindings = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,
    useI18n: () => ({ t }), useHydrated: () => Vue.ref(true), useAccess: () => ({ can: () => true }), useToast: () => ({ add: toast }),
    refDebounced: (value: unknown) => value,
    useCreateHrEmployee: mutationHook, useUpdateHrEmployee: mutationHook, useCreateDepartment: mutationHook, useUpdateDepartment: mutationHook,
    useHrEmployees: list, useHrEmployee: () => ({ data: Vue.ref(null), error: Vue.ref(null), refetch: vi.fn() }),
    saveErrorMessage, nextTick: Vue.nextTick, hrManagerOptions, retryHrManagerQueries: vi.fn(), getAllowedParentIds, ApiError,
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const state = component.setup(props, { expose: () => {}, emit })
  const compiled = compileTemplate({ source: descriptor.template!.content, filename, id: 'hr-save-feedback', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(compiled.code))(Vue)
  async function rendered() {
    const nodes: { name: string; props: Record<string, any> }[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...props, ...state }), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]!))) {
      app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
        return () => { nodes.push({ name, props: { ...attrs } }); return Vue.h('div', slots.default?.()) }
      } }))
    }
    await renderToString(app)
    return nodes
  }
  return { state, mutation, toast, emit, result, rendered }
}

describe.each(forms)('%s save feedback', file => {
  it.each([503, 422])('retains a %i failure inline and preserves the draft until a successful retry', async status => {
    const view = await load(file)
    view.state.name.value = 'مسودة'
    if (file.startsWith('Employee')) view.state.email.value = 'draft@example.test'
    const cause = new ApiError(status, status === 422 ? 'invalid' : 'unavailable', status === 422 ? 'name contains a disallowed value' : 'temporarily unavailable', status === 422 ? 'name' : undefined)
    view.mutation.mockRejectedValueOnce(cause)
    await view.state.submit()
    const nodes = await view.rendered()
    const alert = nodes.find(node => node.name === 'UAlert')
    expect(alert?.props.role).toBe('alert')
    expect(alert?.props.title).toBe('تعذر حفظ التغييرات. راجع التفاصيل ثم حاول مرة أخرى.')
    expect(alert?.props.description).toBe(cause.message)
    expect(nodes.findIndex(node => node.name === 'UAlert')).toBeLessThan(nodes.findIndex(node => node.name === 'UFormField'))
    expect(view.state.name.value).toBe('مسودة')
    expect(view.state.dirty.value).toBe(true)
    expect(view.emit).not.toHaveBeenCalled()
    expect(view.toast).not.toHaveBeenCalled()
    if (status === 422) {
      expect(nodes.find(node => node.name === 'UFormField' && node.props.name === (file.startsWith('Employee') ? 'hr-employee-name' : 'hr-dept-name'))?.props.error).toBe(cause.message)
    }
    await view.state.submit()
    expect((await view.rendered()).some(node => node.name === 'UAlert')).toBe(false)
    expect(view.state.dirty.value).toBe(false)
    expect(view.emit).toHaveBeenCalledExactlyOnceWith('saved', view.result)
  })
})
