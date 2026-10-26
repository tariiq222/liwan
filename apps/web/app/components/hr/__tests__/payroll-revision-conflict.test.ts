import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import * as contracts from '@webvue/contracts'
import { ApiError } from '../../../composables/useApi'
import { usePayrollConflict } from '../../../composables/usePayrollConflict'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { gosiRatePatch } from '../../../utils/payrollSettings'
import { payrollErrorMessage, payrollFieldError } from '../../../utils/payrollErrors'
import { parseMoneyInput } from '../../../utils/moneyInput'

// The GOSI rate and salary file profile editors send the revision of the row they opened; a 409 keeps the draft, blocks
// a second save and lets the user reload the latest row explicitly. State test: the component's <script setup> runs with
// its declared imports and the mutations replaced.
const MODULES: Record<string, unknown> = {
  'vue': Vue,
  '@webvue/contracts': contracts,
  '@webvue/ui/app/utils/formatDate': { formatDate: (value: string) => value },
  '@/composables/useApi': { ApiError },
  '@/utils/formFeedback': { saveErrorMessage },
  '@/utils/payrollSettings': { gosiRatePatch },
  '@/utils/payrollErrors': { payrollErrorMessage, payrollFieldError },
  '@/utils/moneyInput': { parseMoneyInput },
  '@/utils/payrollFormat': { formatPayrollAmount: String, formatPayrollPercent: String },
}

function mount(file: string, props: Record<string, unknown>, mutations: Record<string, unknown>) {
  const filename = resolve(import.meta.dirname, `../payroll/${file}`)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const code = ts.transpileModule(compileScript(descriptor, { id: file }).content, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const require = (specifier: string) => {
    if (specifier in MODULES) return MODULES[specifier]
    throw new Error(`${file} imports ${specifier}; declare it in MODULES`)
  }
  const globals = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, reactive: Vue.reactive,
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('ar') }), useHydrated: () => Vue.ref(true), usePayrollConflict,
    ...mutations,
  }
  const exports: { default?: { setup: (props: unknown, context: unknown) => Record<string, any> } } = {}
  new Function('require', 'exports', ...Object.keys(globals), code)(require, exports, ...Object.values(globals))
  return exports.default!.setup(Vue.reactive(props), { expose: () => {}, emit: () => {}, attrs: {}, slots: {} })
}

const mutation = (fn: (input: unknown) => Promise<unknown>) => () => ({ mutateAsync: fn, isPending: Vue.ref(false) })
const stale = () => new ApiError(409, 'conflict', 'changed; reload before saving')

const RATE = {
  id: 7, branch: 'annuities', nationality_class: 'gcc', date_from: '2026-01-01',
  employee_rate: 9, employer_rate: 9, wage_min: 1500, wage_max: 45000, shared: false, revision: 2,
} as const

describe('GosiRateTable revision conflicts', () => {
  function gosi(save: (input: unknown) => Promise<unknown>, remove: (input: unknown) => Promise<unknown>, reloadRates = vi.fn()) {
    return mount('GosiRateTable.vue', { rates: [RATE], canEdit: true, reloadRates }, {
      useSaveHrGosiRate: mutation(save), useDeleteHrGosiRate: mutation(remove),
    })
  }

  it('an edit sends the changed fields and the opened revision; a stale one keeps the draft until a reload', async () => {
    const save = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValue(RATE)
    const reloadRates = vi.fn(async () => [{ ...RATE, employee_rate: 9.5, revision: 3 }])
    const state = gosi(save, vi.fn(), reloadRates)
    state.open(RATE)
    state.numbers.employer_rate = '10'
    await state.submit()
    expect(save).toHaveBeenCalledWith({ id: 7, body: { employer_rate: 10, revision: 2 } })
    expect(state.conflict.value).toBe(true)
    expect(state.formAlert.value).toBe('hrPayroll.revision.conflict')
    expect(state.numbers.employer_rate).toBe('10')
    await state.submit()
    expect(save).toHaveBeenCalledTimes(1)
    await state.reload()
    expect(state.conflict.value).toBe(false)
    expect(state.editing.value.revision).toBe(3)
    expect(state.numbers.employee_rate).toBe('9.5')
    state.numbers.employer_rate = '10'
    await state.submit()
    expect(save).toHaveBeenLastCalledWith({ id: 7, body: { employer_rate: 10, revision: 3 } })
  })

  it('a delete sends the revision it read and a stale delete is refused without removing the confirmation', async () => {
    const remove = vi.fn().mockRejectedValue(stale())
    const state = gosi(vi.fn(), remove)
    state.askDelete(RATE)
    await state.confirmDelete()
    expect(remove).toHaveBeenCalledWith({ id: 7, revision: 2 })
    expect(state.conflict.value).toBe(true)
    expect(state.deleting.value).toEqual(RATE)
    await state.confirmDelete()
    expect(remove).toHaveBeenCalledTimes(1)
  })
})

const PROFILE = {
  id: 4, name: 'Bank', kind: 'bank', delimiter: ',', encoding: 'utf-8', include_header: true, footer: 'none',
  columns: [{ source: 'iban', label: 'IBAN', constant_value: '' }], shared: false, revision: 5,
} as const

describe('BankProfileForm revision conflicts', () => {
  function profiles(save: (input: unknown) => Promise<unknown>, remove: (input: unknown) => Promise<unknown>, reloadProfiles = vi.fn()) {
    return mount('BankProfileForm.vue', { profiles: [PROFILE], canEdit: true, reloadProfiles }, {
      useSaveHrBankProfile: mutation(save), useDeleteHrBankProfile: mutation(remove),
    })
  }

  it('an edit sends the opened revision; a stale one keeps the draft and the reload brings the latest profile', async () => {
    const save = vi.fn().mockRejectedValue(stale())
    const reloadProfiles = vi.fn(async () => [{ ...PROFILE, name: 'Bank renamed', revision: 6 }])
    const state = profiles(save, vi.fn(), reloadProfiles)
    state.open(PROFILE)
    state.footer.value = 'totals'
    await state.submit()
    expect(save).toHaveBeenCalledWith({ id: 4, body: expect.objectContaining({ footer: 'totals', revision: 5 }) })
    expect(state.conflict.value).toBe(true)
    expect(state.footer.value).toBe('totals')
    await state.reload()
    expect([state.conflict.value, state.editing.value.revision, state.name.value]).toEqual([false, 6, 'Bank renamed'])
  })

  it('a delete sends the revision it read; a failed reload keeps the conflict', async () => {
    const remove = vi.fn().mockRejectedValue(stale())
    const state = profiles(vi.fn(), remove, vi.fn().mockRejectedValue(new Error('offline')))
    state.askDelete(PROFILE)
    await state.confirmDelete()
    expect(remove).toHaveBeenCalledWith({ id: 4, revision: 5 })
    await state.reload()
    expect([state.conflict.value, Boolean(state.reloadFailure.value)]).toEqual([true, true])
  })

  it('a refused delete of a profile a kept file names shows the payroll text, not the server English', async () => {
    const remove = vi.fn().mockRejectedValue(
      new ApiError(409, 'profile_in_use', 'This salary file profile is kept by a generated salary file.'),
    )
    const state = profiles(vi.fn(), remove)
    state.askDelete(PROFILE)
    await state.confirmDelete()
    expect(state.deleting.value).toEqual(PROFILE)
    // The test's t() echoes the key: the page text is the code's own locale key, never the server message.
    expect(state.deleteAlert.value).toBe('hrPayroll.errors.profile_in_use')
  })
})
