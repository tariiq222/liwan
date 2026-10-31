import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { HrCompensationWriteSchema } from '@liwan/contracts'
import { ApiError } from '../../../composables/useApi'
import { saveErrorMessage } from '../../../utils/formFeedback'
import { parseMoneyInput } from '../../../utils/moneyInput'

// Runs the form's real <script setup> without the DOM (the same harness idea as employee-general-form.test.ts).
const filename = resolve(import.meta.dirname, '../payroll/CompensationForm.vue')
const record = {
  employee: { id: 3, name: 'ليلى' }, basic_wage: 8000, housing_allowance: 2000, transport_allowance: 500, other_allowance: 0,
  fixed_wage: 10500, iban: 'SA0380000000608010167519', bank: { id: 4, name: 'بنك' }, gosi_number: null, gosi_registration_date: null, nationality: null, relationship_type: 'employee',
}

function load(props: { employeeId: number; compensation: typeof record | null }) {
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'compensation-form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const reactiveProps = Vue.reactive(props)
  const save = vi.fn(async (body: unknown) => ({ ...record, ...(body as object) }))
  const emit = vi.fn()
  const bindings = {
    _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: vi.fn() }),
    useSaveHrCompensation: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    usePayrollRelationshipItems: () => Vue.computed(() => []),
    useHrPayrollBanks: () => ({ data: Vue.ref({ items: [{ id: 4, name: 'بنك', bic: null }, { id: 5, name: 'مصرف', bic: 'RJHISARI' }], total: 2 }), isFetching: Vue.ref(false) }),
    HrCompensationWriteSchema, ApiError, saveErrorMessage, parseMoneyInput,
  }
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const state = component.setup(reactiveProps, { expose: () => {}, emit })
  return { state, save, emit, props: reactiveProps }
}

describe('CompensationForm amounts', () => {
  it('submits numeric amounts whether a field holds text or a number', async () => {
    const { state, save, emit } = load({ employeeId: 3, compensation: record })
    state.basicWage.value = 8500 // a numeric input emits a number after the first keystroke
    state.housingAllowance.value = '2500'
    await state.submit()
    expect(save).toHaveBeenCalledWith({
      basic_wage: 8500, housing_allowance: 2500, transport_allowance: 500, other_allowance: 0,
      iban: 'SA0380000000608010167519', bank_id: 4, gosi_number: null, gosi_registration_date: null, relationship_type: 'employee',
    })
    expect(emit).toHaveBeenCalledWith('saved', expect.anything())
  })

  it('submits the bank the customer picked, and null when none is on record', async () => {
    const { state, save } = load({ employeeId: 3, compensation: record })
    state.bankId.value = 5
    await state.submit()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ bank_id: 5 }))
    const empty = load({ employeeId: 4, compensation: null })
    empty.state.basicWage.value = '1000'
    await empty.state.submit()
    expect(empty.save).toHaveBeenCalledWith(expect.objectContaining({ bank_id: null }))
  })

  it('offers the bank on record even when the catalog does not list it', () => {
    const { state } = load({ employeeId: 3, compensation: { ...record, bank: { id: 99, name: 'بنك قديم' } } })
    expect(state.bankItems.value[0]).toEqual({ value: 99, label: 'بنك قديم' })
  })

  it('submits the relationship the customer chose, whatever it is', async () => {
    const { state, save } = load({ employeeId: 3, compensation: record })
    state.relationshipType.value = 'consultant'
    await state.submit()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ relationship_type: 'consultant' }))
  })

  it('reads Arabic-Indic digits and the Arabic decimal mark', async () => {
    const { state, save } = load({ employeeId: 3, compensation: record })
    state.basicWage.value = '٨٥٠٠٫٥٠'
    await state.submit()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ basic_wage: 8500.5 }))
  })

  it('refuses an empty basic wage without calling the server', async () => {
    const { state, save } = load({ employeeId: 3, compensation: record })
    state.basicWage.value = ''
    await state.submit()
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps unsaved edits on a refetch and reseeds a clean form', async () => {
    const { state, props } = load({ employeeId: 3, compensation: record })
    state.basicWage.value = 9000
    props.compensation = { ...record, basic_wage: 8100 }
    await Vue.nextTick()
    expect(state.basicWage.value).toBe(9000)
    state.basicWage.value = '8000' // back to the seeded text: the form is clean again
    props.compensation = { ...record, basic_wage: 8200 }
    await Vue.nextTick()
    expect(state.basicWage.value).toBe('8200')
  })
})
