import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HrPayrollSettingsPatchSchema } from '@liwan/contracts'
import { DEFAULT_STUBS, fakeT } from '@liwan/ui/test/helpers/renderShared'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { payrollSettingsPatch } from '../../../utils/payrollSettings'
import { payrollFieldError } from '../../../utils/payrollErrors'

// Payroll settings are readable with hr.payroll.read; only hr.payroll.config edits them (owner decision D-6), and the
// page passes that as `canEdit`. The form is one SharedSettingsCard: its draft and revision come from useSettingsForm,
// and the card's `save` (driven by the page's one save bar) runs the form's submit. Rendered test: the form's real
// <script setup> and template are rendered to HTML (SSR) with declared imports; the Nuxt UI controls are stand-ins that
// print their `disabled` state.
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
const STRUCTURES = [{ id: 1, name: 'Saudi', code: 'SA_MONTHLY' }, { id: 9, name: 'Own copy', code: 'SA_MONTHLY' }]

const MODULES: Record<string, unknown> = {
  'vue': Vue,
  '@liwan/contracts': { HrPayrollSettingsPatchSchema },
  '@/composables/useApi': { ApiError },
  '@/composables/settings/useSettingsForm': { useSettingsForm },
  '@/utils/formFeedback': { saveErrorMessage },
  '@/utils/payrollSettings': { payrollSettingsPatch },
  '@/utils/payrollErrors': { payrollFieldError },
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
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', ...Object.keys(globals), source)(require, exports, ...Object.values(globals))
  return exports.default!
}

const control = (tag: string) => Vue.defineComponent({
  inheritAttrs: false,
  setup(_, { attrs }) { return () => Vue.h(tag, { 'id': attrs.id, 'data-testid': attrs['data-testid'], 'disabled': attrs.disabled === true || attrs.disabled === '' ? '' : undefined }) },
})
// The real card registers with the page's save bar instead of drawing its own footer: the stub hands the test the
// state and the card's save, and draws a footer button only where the real card would (no settings page).
const card = Vue.defineComponent({
  inheritAttrs: false,
  props: ['id', 'dirty', 'canEdit', 'message', 'conflict', 'onSave'],
  setup(props, { slots }) {
    return () => Vue.h('section', { 'data-card': props.id, 'data-can-edit': props.canEdit, 'data-dirty': props.dirty, 'data-has-save': typeof props.onSave === 'function' }, [
      props.message ? Vue.h('p', { 'role': 'alert' }, props.message) : null, slots.default?.(),
    ])
  },
})
const passthrough = Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => Vue.h('div', attrs, slots.default?.()) } })

async function render(canEdit: boolean) {
  const save = vi.fn(async (body: unknown) => ({ ...SETTINGS, ...(body as object) }))
  const app = Vue.createSSRApp({ render: () => Vue.h(load(save), { settings: SETTINGS, leaveTypes: LEAVE_TYPES, structures: STRUCTURES, canEdit, reloadSettings: vi.fn() }) })
  app.config.globalProperties.$t = fakeT() as never
  for (const [tag, stub] of Object.entries({
    ...DEFAULT_STUBS, SharedSettingsCard: card, UFormField: passthrough,
    USelect: control('select'), UInput: control('input'), UCheckboxGroup: control('fieldset'),
  })) app.component(tag, stub)
  return renderToString(app)
}

const disabled = (html: string, testId: string) => new RegExp(`<\\w+[^>]*data-testid="${testId}"[^>]*\\sdisabled`).test(html)

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: fakeT() })) })

describe('PayrollGeneralSettingsForm follows canEdit', () => {
  it('a payroll reader without config sees every field disabled and no save of its own', async () => {
    const html = await render(false)
    for (const testId of ['hr-payroll-divisor', 'hr-payroll-structure', 'hr-payroll-annual', 'hr-payroll-unpaid']) expect(disabled(html, testId), testId).toBe(true)
    // The page's one save bar saves the card; the form has no submit button of its own.
    expect(html).not.toContain('data-testid="hr-payroll-settings-submit"')
    expect(html).toContain('data-can-edit="false"')
  })

  it('a payroll configurator gets enabled fields, and the card owns the save the page bar runs', async () => {
    const html = await render(true)
    for (const testId of ['hr-payroll-divisor', 'hr-payroll-structure', 'hr-payroll-annual', 'hr-payroll-unpaid']) expect(disabled(html, testId), testId).toBe(false)
    expect(html).not.toContain('data-testid="hr-payroll-settings-submit"')
    expect(html).toContain('data-can-edit="true"')
    expect(html).toContain('data-has-save="true"')
  })
})

// The draft and the conflict state, read straight from the component's setup (no rendering needed).
function setup(save: (body: unknown) => Promise<unknown>, reloadSettings: () => Promise<unknown>) {
  const props = Vue.reactive({ settings: SETTINGS, leaveTypes: LEAVE_TYPES, structures: STRUCTURES, canEdit: true, reloadSettings })
  const component = load(save, stateCode) as { setup: (props: unknown, context: unknown) => Record<string, any> }
  return { props, form: component.setup(props, { expose: () => {}, emit: () => {}, attrs: {}, slots: {} }) }
}

describe('PayrollGeneralSettingsForm sends its baseline revision', () => {
  it('sends the structure the user picked', async () => {
    const save = vi.fn(async (body: unknown) => ({ ...SETTINGS, structure: { id: 9, name: 'Own copy' }, revision: 3, ...(body as object) }))
    const { form } = setup(save, vi.fn())
    form.draft.value.structure = '9'
    await form.submit()
    expect(save).toHaveBeenCalledWith({ structure_id: 9, revision: 2 })
  })

  it('saves only the changed fields with the revision the draft started from', async () => {
    const save = vi.fn(async (body: unknown) => ({ ...SETTINGS, day_divisor: 28, revision: 3, ...(body as object) }))
    const { form } = setup(save, vi.fn())
    form.draft.value.dayDivisor = '28'
    await form.submit()
    expect(save).toHaveBeenCalledWith({ day_divisor: 28, revision: 2 })
  })

  it('keeps the draft on a 409, shows the conflict and saves again only after an explicit reload', async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError(409, 'conflict', 'payroll settings changed'))
      .mockImplementation(async (body: unknown) => ({ ...SETTINGS, ...(body as object), revision: 4 }))
    const reload = vi.fn(async () => ({ ...SETTINGS, day_divisor: 31, revision: 3 }))
    const { form, props } = setup(save, reload)
    form.draft.value.dayDivisor = '28'
    await form.submit()
    expect(form.state.value.conflict).toBe(true)
    expect(form.state.value.message).toBe('app.settingsConflict')
    expect(form.draft.value.dayDivisor).toBe('28')
    // A background refetch cannot replace the stale baseline while the conflict is open.
    props.settings = { ...SETTINGS, day_divisor: 31, revision: 3 }
    await Vue.nextTick()
    await form.submit()
    expect(save).toHaveBeenCalledTimes(1)
    await form.reload()
    expect(reload).toHaveBeenCalledTimes(1)
    expect([form.draft.value.dayDivisor, form.state.value.conflict]).toEqual(['31', false])
    form.draft.value.dayDivisor = '29'
    await form.submit()
    expect(save).toHaveBeenLastCalledWith({ day_divisor: 29, revision: 3 })
  })

  it('a failed reload keeps the draft and the conflict', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'changed'))
    const { form } = setup(save, vi.fn().mockRejectedValue(new ApiError(0, 'network', 'offline')))
    form.draft.value.dayDivisor = '28'
    await form.submit()
    await form.reload()
    expect(form.state.value.reloadFailed).toBe(true)
    expect(form.draft.value.dayDivisor).toBe('28')
    expect(form.state.value.conflict).toBe(true)
  })

  it('a draft outside the contract is refused before anything is sent', async () => {
    const save = vi.fn()
    const { form } = setup(save, vi.fn())
    form.draft.value.dayDivisor = '32'
    await form.submit()
    expect(save).not.toHaveBeenCalled()
  })

  it('leaves the sentence on the field the server named and keeps only the plain failure on the card', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(422, 'annual_leave_type_missing', '', 'annual_leave_type_id'))
    const { form } = setup(save, vi.fn())
    form.draft.value.annualLeaveType = '4'
    await form.submit()
    expect(form.fieldError('annual_leave_type_id')).toBe('hrPayroll.errors.annual_leave_type_missing')
    expect(form.state.value.message).toBe('errors.generic')
    expect(form.state.value.conflict).toBe(false)
    expect(form.draft.value.annualLeaveType).toBe('4')
  })
})
