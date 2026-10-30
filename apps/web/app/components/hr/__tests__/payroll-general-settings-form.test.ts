import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { HrPayrollSettingsPatchSchema } from '@liwan/contracts'
import { DEFAULT_STUBS, fakeT } from '@liwan/ui/test/helpers/renderShared'
import { ApiError } from '../../../composables/useApi'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { payrollSettingsPatch } from '../../../utils/payrollSettings'
import { isPayrollConflict, payrollFieldError } from '../../../utils/payrollErrors'
import { usePayrollConflict } from '../../../composables/usePayrollConflict'

// Payroll settings are readable with hr.payroll.read; only hr.payroll.config edits them (owner decision D-6), and the
// page passes that as `canEdit`. Rendered test: the form's real <script setup> and template are rendered to HTML (SSR)
// with declared imports; the Nuxt UI controls are stand-ins that print their `disabled` state.
const filename = resolve(import.meta.dirname, '../payroll/PayrollGeneralSettingsForm.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const transpile = (inlineTemplate: boolean) => ts.transpileModule(compileScript(descriptor, { id: 'payroll-general-settings', inlineTemplate }).content, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText
// The rendered build; the second build's setup returns its bindings, so a test reads the draft and conflict state.
const code = transpile(true)
const stateCode = transpile(false)

const SETTINGS = { day_divisor: 30, structure: { id: 1, name: 'Saudi' }, unpaid_leave_types: [{ id: 4, name: 'Unpaid' }], annual_leave_type: { id: 3, name: 'Annual' }, revision: 2 }
const LEAVE_TYPES = [{ id: 3, name: 'Annual' }, { id: 4, name: 'Unpaid' }]

const MODULES: Record<string, unknown> = {
  'vue': Vue,
  '@liwan/contracts': { HrPayrollSettingsPatchSchema },
  '@/composables/useApi': { ApiError },
  '@/utils/formFeedback': { saveErrorMessage },
  '@/utils/payrollSettings': { payrollSettingsPatch },
  '@/utils/payrollErrors': { payrollFieldError, isPayrollConflict },
}

function load(save: (body: unknown) => Promise<unknown>, source = code) {
  const require = (specifier: string) => {
    if (specifier in MODULES) return MODULES[specifier]
    throw new Error(`PayrollGeneralSettingsForm.vue imports ${specifier}; declare it in MODULES`)
  }
  const globals = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: fakeT() }), useHydrated: () => Vue.ref(true),
    usePatchHrPayrollSettings: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    usePayrollConflict,
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', ...Object.keys(globals), source)(require, exports, ...Object.values(globals))
  return exports.default!
}

const control = (tag: string) => Vue.defineComponent({
  inheritAttrs: false,
  setup(_, { attrs }) { return () => Vue.h(tag, { 'id': attrs.id, 'data-testid': attrs['data-testid'], 'disabled': attrs.disabled === true || attrs.disabled === '' ? '' : undefined }) },
})
const wrapper = Vue.defineComponent({ inheritAttrs: false, setup(_, { slots }) { return () => Vue.h('div', slots.default?.()) } })

async function render(canEdit: boolean) {
  const save = vi.fn(async (body: unknown) => ({ ...SETTINGS, ...(body as object) }))
  const app = Vue.createSSRApp({ render: () => Vue.h(load(save), { settings: SETTINGS, leaveTypes: LEAVE_TYPES, canEdit, reloadSettings: vi.fn() }) })
  app.config.globalProperties.$t = fakeT() as never
  for (const [tag, stub] of Object.entries({
    ...DEFAULT_STUBS, UForm: wrapper, UFormField: wrapper, SharedFormSection: wrapper, SharedFormActions: wrapper, SharedUnsavedChanges: wrapper,
    USelect: control('select'), UInput: control('input'), UCheckboxGroup: control('fieldset'),
  })) app.component(tag, stub)
  return renderToString(app)
}

const disabled = (html: string, testId: string) => new RegExp(`<\\w+[^>]*data-testid="${testId}"[^>]*\\sdisabled`).test(html)

describe('PayrollGeneralSettingsForm follows canEdit', () => {
  it('a payroll reader without config sees every field disabled and no save button', async () => {
    const html = await render(false)
    for (const testId of ['hr-payroll-divisor', 'hr-payroll-annual', 'hr-payroll-unpaid']) expect(disabled(html, testId), testId).toBe(true)
    expect(html).not.toContain('data-testid="hr-payroll-settings-submit"')
  })

  it('a payroll configurator gets enabled fields and the save button', async () => {
    const html = await render(true)
    for (const testId of ['hr-payroll-divisor', 'hr-payroll-annual', 'hr-payroll-unpaid']) expect(disabled(html, testId), testId).toBe(false)
    expect(html).toContain('data-testid="hr-payroll-settings-submit"')
  })
})

// The draft and the conflict state, read straight from the component's setup (no rendering needed).
function setup(save: (body: unknown) => Promise<unknown>, reloadSettings: () => Promise<unknown>) {
  const props = Vue.reactive({ settings: SETTINGS, leaveTypes: LEAVE_TYPES, canEdit: true, reloadSettings })
  const component = load(save, stateCode) as { setup: (props: unknown, context: unknown) => Record<string, any> }
  return { props, state: component.setup(props, { expose: () => {}, emit: () => {}, attrs: {}, slots: {} }) }
}

describe('PayrollGeneralSettingsForm sends its baseline revision', () => {
  it('saves only the changed fields with the revision the draft started from', async () => {
    const save = vi.fn(async (body: unknown) => ({ ...SETTINGS, day_divisor: 28, revision: 3, ...(body as object) }))
    const { state } = setup(save, vi.fn())
    state.dayDivisor.value = '28'
    await state.submit()
    expect(save).toHaveBeenCalledWith({ day_divisor: 28, revision: 2 })
  })

  it('keeps the draft on a 409, shows the conflict and saves again only after an explicit reload', async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError(409, 'conflict', 'payroll settings changed'))
      .mockImplementation(async (body: unknown) => ({ ...SETTINGS, ...(body as object), revision: 4 }))
    const reload = vi.fn(async () => ({ ...SETTINGS, day_divisor: 31, revision: 3 }))
    const { state, props } = setup(save, reload)
    state.dayDivisor.value = '28'
    await state.submit()
    expect(state.conflict.value).toBe(true)
    expect(state.alertMessage.value).toBe('hrPayroll.revision.conflict')
    expect(state.dayDivisor.value).toBe('28')
    // A background refetch cannot replace the stale baseline while the conflict is open.
    props.settings = { ...SETTINGS, day_divisor: 31, revision: 3 }
    await Vue.nextTick()
    expect(state.baseline.value.revision).toBe(2)
    await state.submit()
    expect(save).toHaveBeenCalledTimes(1)
    await state.reload()
    expect(reload).toHaveBeenCalledTimes(1)
    expect([state.baseline.value.revision, state.dayDivisor.value]).toEqual([3, '31'])
    expect(state.conflict.value).toBe(false)
    state.dayDivisor.value = '29'
    await state.submit()
    expect(save).toHaveBeenLastCalledWith({ day_divisor: 29, revision: 3 })
  })

  it('a failed reload keeps the draft and the conflict', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'changed'))
    const { state } = setup(save, vi.fn().mockRejectedValue(new ApiError(0, 'network', 'offline')))
    state.dayDivisor.value = '28'
    await state.submit()
    await state.reload()
    expect(state.reloadFailure.value).toBeTruthy()
    expect(state.dayDivisor.value).toBe('28')
    expect(state.conflict.value).toBe(true)
  })
})
