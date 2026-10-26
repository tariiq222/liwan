import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { HrPayrollSettingsPatchSchema } from '@webvue/contracts'
import { DEFAULT_STUBS, fakeT } from '@webvue/ui/test/helpers/renderShared'
import { ApiError } from '../../../composables/useApi'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { payrollSettingsPatch } from '../../../utils/payrollSettings'
import { payrollFieldError } from '../../../utils/payrollErrors'

// Payroll settings are readable with hr.payroll.read; only hr.payroll.config edits them (owner decision D-6), and the
// page passes that as `canEdit`. Rendered test: the form's real <script setup> and template are rendered to HTML (SSR)
// with declared imports; the Nuxt UI controls are stand-ins that print their `disabled` state.
const filename = resolve(import.meta.dirname, '../payroll/PayrollGeneralSettingsForm.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const code = ts.transpileModule(compileScript(descriptor, { id: 'payroll-general-settings', inlineTemplate: true }).content, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText

const SETTINGS = { day_divisor: 30, structure: { id: 1, name: 'Saudi' }, unpaid_leave_types: [{ id: 4, name: 'Unpaid' }], annual_leave_type: { id: 3, name: 'Annual' } }
const LEAVE_TYPES = [{ id: 3, name: 'Annual' }, { id: 4, name: 'Unpaid' }]

const MODULES: Record<string, unknown> = {
  'vue': Vue,
  '@webvue/contracts': { HrPayrollSettingsPatchSchema },
  '@/composables/useApi': { ApiError },
  '@/utils/formFeedback': { saveErrorMessage },
  '@/utils/payrollSettings': { payrollSettingsPatch },
  '@/utils/payrollErrors': { payrollFieldError },
}

function load(save: (body: unknown) => Promise<unknown>) {
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
  new Function('require', 'exports', ...Object.keys(globals), code)(require, exports, ...Object.values(globals))
  return exports.default!
}

const control = (tag: string) => Vue.defineComponent({
  inheritAttrs: false,
  setup(_, { attrs }) { return () => Vue.h(tag, { 'id': attrs.id, 'data-testid': attrs['data-testid'], 'disabled': attrs.disabled === true || attrs.disabled === '' ? '' : undefined }) },
})
const wrapper = Vue.defineComponent({ inheritAttrs: false, setup(_, { slots }) { return () => Vue.h('div', slots.default?.()) } })

async function render(canEdit: boolean) {
  const save = vi.fn(async (body: unknown) => ({ ...SETTINGS, ...(body as object) }))
  const app = Vue.createSSRApp({ render: () => Vue.h(load(save), { settings: SETTINGS, leaveTypes: LEAVE_TYPES, canEdit }) })
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
