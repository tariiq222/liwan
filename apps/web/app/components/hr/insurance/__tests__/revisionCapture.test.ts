import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { HrInsuranceDependent, HrInsurancePlan } from '@liwan/contracts'
import { ApiError } from '../../../../composables/useApi'
import { isHrInsuranceConflict } from '../../../../composables/useHrInsurance'

// An editor, a confirmation and a form save with the revision they opened at. A background refetch that
// delivers a newer revision must not advance it, so another manager's concurrent edit answers 409.
const mutation = (fn: (input: unknown) => Promise<unknown>) => () => ({ mutateAsync: fn, isPending: Vue.ref(false) })

function load(file: string, id: string, bindings: Record<string, unknown>, props: object, emit = vi.fn()) {
  const path = resolve(import.meta.dirname, `../${file}`)
  const descriptor = parse(readFileSync(path, 'utf8'), { filename: path }).descriptor
  const script = compileScript(descriptor, { id }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const all = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), ApiError, isHrInsuranceConflict, ...bindings,
  }
  const component = new Function(...Object.keys(all), ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText)(...Object.values(all))
  return component.setup(Vue.reactive(props), { expose: () => {}, emit })
}

const dependent = (over: Partial<HrInsuranceDependent> = {}): HrInsuranceDependent => ({
  id: 9, enrollment_id: 5, name: 'Omar', relation: 'child', birth_date: '2018-04-12', national_id_masked: '******5432', national_id: '1098765432',
  date_from: '2026-02-01', date_to: '2026-09-01', state: 'active', revision: 1, ...over,
})

function dependents(patch: (input: unknown) => Promise<unknown>, end: (input: unknown) => Promise<unknown>, rows: HrInsuranceDependent[]) {
  const props = { enrollmentId: 5, dependents: rows, canEdit: true, requireId: false, from: '2026-02-01', to: '2026-12-31' }
  const state = load('DependentsSection.vue', 'dependents', {
    useAddHrInsuranceDependent: mutation(vi.fn()), usePatchHrInsuranceDependent: mutation(patch), useEndHrInsuranceDependent: mutation(end),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }), hrInsuranceKeys: { all: ['hr', 'insurance'] }, HR_INSURANCE_RELATIONS: ['spouse', 'child', 'parent', 'other'], formatDate: (v: string) => v,
  }, props)
  return { state, props: Vue.reactive(props) }
}

describe('DependentsSection', () => {
  it('saves the edit with the revision the editor opened at and clears optional fields with an explicit null', async () => {
    const patch = vi.fn().mockResolvedValue(dependent())
    const { state } = dependents(patch, vi.fn(), [dependent()])
    state.openEdit(dependent({ revision: 1 }))
    state.draft.value.dateTo = null
    state.draft.value.birthDate = null
    state.draft.value.nationalId = ''
    // A refetch delivers revision 2 while the editor is open: the save still sends revision 1.
    await state.save(dependent({ revision: 2 }))
    expect(patch).toHaveBeenCalledWith({
      id: 9,
      body: { name: 'Omar', relation: 'child', date_from: '2026-02-01', birth_date: null, national_id: null, date_to: null, revision: 1 },
    })
  })

  it('ends with the revision the confirmation opened at, and a conflict offers the reload', async () => {
    const end = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'changed'))
    const { state } = dependents(vi.fn(), end, [dependent()])
    state.openEnd(dependent({ revision: 3 }))
    await state.confirmEnd(dependent({ revision: 4 }))
    expect(end).toHaveBeenCalledWith({ id: 9, revision: 3, dateEnd: undefined })
    expect(state.conflict.value).toBe(true)
    expect(state.error.value).toBe('hrInsurance.conflict')
    state.reload()
    expect(state.conflict.value).toBe(false)
  })
})

describe('PlanForm', () => {
  const plan = (over: Partial<HrInsurancePlan> = {}): HrInsurancePlan => ({
    id: 3, provider: { id: 1, name: 'Bupa' }, name: 'Gold', tier: null, policy_number: null, valid_from: '2026-01-01', valid_to: '2026-12-31',
    annual_premium: null, state: 'active', expires_in_days: 60, active: true, revision: 1, ...over,
  })

  it('keeps the opened revision across a refetch, takes the saved plan as the new baseline and reloads after a conflict', async () => {
    const patch = vi.fn().mockRejectedValueOnce(new ApiError(409, 'conflict', 'changed')).mockResolvedValueOnce(plan({ name: 'Platinum', revision: 3 }))
    const props = Vue.reactive({ providers: [], backTo: '/hr/insurance', plan: plan() })
    const state = load('PlanForm.vue', 'plan-form', {
      useCreateHrInsurancePlan: mutation(vi.fn()), usePatchHrInsurancePlan: mutation(patch),
    }, props)
    state.name.value = 'Platinum'
    // Another manager saved revision 2 and the page refetched it: this form still saves revision 1 and gets the 409.
    props.plan = plan({ name: 'Gold Plus', revision: 2 })
    await state.submit()
    expect(patch).toHaveBeenCalledWith({ id: 3, body: expect.objectContaining({ name: 'Platinum', revision: 1 }) })
    expect(state.conflict.value).toBe(true)
    state.reload()
    expect(state.conflict.value).toBe(false)
    expect(state.name.value).toBe('Gold Plus')
    state.name.value = 'Platinum'
    await state.submit()
    expect(patch).toHaveBeenLastCalledWith({ id: 3, body: expect.objectContaining({ revision: 2 }) })
    expect(state.baseline.value.revision).toBe(3)
    expect(state.dirty.value).toBe(false)
  })
})
