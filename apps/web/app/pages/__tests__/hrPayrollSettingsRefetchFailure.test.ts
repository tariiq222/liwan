import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { usePayrollConflict } from '../../composables/usePayrollConflict'

const filename = resolve(import.meta.dirname, '../settings/apps/hr/index.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
type Name = 'settings' | 'rates' | 'profiles' | 'cases'

/** The page's setup with the payroll queries; `failing` fails, `unloaded` never got its data. */
function setupPayroll(failing: Name, unloaded = false) {
  const query = (data: unknown) => ({ data: Vue.ref(data), error: Vue.ref<unknown>(null), isLoading: Vue.ref(false), refetch: vi.fn() })
  const queries = { settings: query({ revision: 2 }), rates: query({ items: [], total: 0 }), profiles: query({ items: [], total: 0 }), cases: query({ items: [], total: 0 }) }
  queries[failing].error.value = new Error('network down')
  if (unloaded) queries[failing].data.value = undefined
  const idle = () => query(undefined)
  const code = compileScript(descriptor, { id: 'payroll-refetch-failure' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed,
    LeaveSettingsForm: {}, LeaveApprovalCard: {}, ShiftSettingsForm: {}, WarningSettingsForm: {}, WarningTypesCard: {}, InsuranceSettingsForm: {}, InsuranceProvidersCard: {}, EosCaseMapTable: {}, PayrollCostCenterTable: {}, PayrollFinanceSettingsForm: {},
    BankProfileForm: {}, BranchStrictCard: {}, GosiRateTable: {}, PayrollGeneralSettingsForm: {},
    useI18n: () => ({ t: String }), useAccess: () => ({ can: () => true }),
    useSettingsPage: () => ({ parts: Vue.ref([{ id: 'payroll' }]), shows: (id: string) => id === 'payroll' }),
    useHrLeaveSettings: idle, useHrShiftSettings: idle, useHrWarningSettings: idle, useHrWarningTypes: idle, useHrInsuranceSettings: idle, useHrInsuranceProviders: idle, useHrLeaveApprovalProcess: idle,
    useHrPayrollSettings: () => queries.settings, useHrPayrollStructures: idle, useHrGosiRates: () => queries.rates,
    useHrBankProfiles: () => queries.profiles, useHrEosCases: () => queries.cases,
    useHrPayrollFinanceSettings: idle, useHrLeaveTypes: idle,
    useHrPayrollFinanceLookups: () => ({ accounts: idle(), journals: idle(), analyticAccounts: idle() }), useHrPayrollCostCenters: idle,
    useSetHrPayrollCostCenter: () => ({ mutateAsync: vi.fn() }), useSaveHrEosCase: () => ({ mutateAsync: vi.fn() }),
    ApiError: Error, isTruncated: () => false, saveErrorMessage: String, usePayrollConflict, isPayrollConflict: () => false,
  }
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
  return component.setup({}, { expose: () => {} }) as { error: unknown }
}

describe('payroll settings card error', () => {
  it.each(['settings', 'rates', 'profiles', 'cases'] as const)('a failed refetch of loaded %s leaves the editors mounted', (failing) => {
    expect(Vue.unref(setupPayroll(failing).error)).toBeNull()
  })

  it.each(['settings', 'rates', 'profiles', 'cases'] as const)('%s that never loaded fails the card', (failing) => {
    expect(Vue.unref(setupPayroll(failing, true).error)).toBeInstanceOf(Error)
  })
})
