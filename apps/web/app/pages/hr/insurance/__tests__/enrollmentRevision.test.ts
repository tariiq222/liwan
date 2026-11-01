import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../../composables/useApi'
import { isHrInsuranceConflict } from '../../../../composables/useHrInsurance'
import { canChangeHrInsuranceEnrollment, hrInsuranceEnrollmentBadge, hrInsurancePlanBadge } from '../../../../utils/hrInsurance'

// The edit and the end/cancel confirmation of the enrollment record save with the revision they opened at:
// a background refetch delivering a newer revision does not advance it, so a concurrent edit answers 409 with a reload.
const FILE = resolve(import.meta.dirname, '../enrollments/[enrollmentId].vue')

function enrollment(revision: number) {
  return { id: 5, employee: { id: 7, name: 'Noura' }, state: 'active', revision, employee_share: 10, company_share: 20, notes: null, plan: { state: 'active' }, dependents: [] }
}

function mount(step: (input: unknown) => Promise<unknown>, patch: (input: unknown) => Promise<unknown>) {
  const descriptor = parse(readFileSync(FILE, 'utf8'), { filename: FILE }).descriptor
  const script = compileScript(descriptor, { id: 'enrollment-page' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const data = Vue.ref(enrollment(1))
  const refetch = vi.fn().mockResolvedValue(undefined)
  const mutation = (fn: (input: unknown) => Promise<unknown>) => () => ({ mutateAsync: fn, isPending: Vue.ref(false) })
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed,
    useRoute: () => ({ params: { enrollmentId: '5' }, query: {}, hash: '' }),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }), useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: () => true }), useRecordListPaths: () => Vue.ref(['/hr/insurance']),
    useHrInsuranceEnrollment: () => ({ data, error: Vue.ref(null), isLoading: Vue.ref(false), refetch }),
    useHrInsuranceSettings: () => ({ data: Vue.ref(undefined) }),
    useStepHrInsuranceEnrollment: mutation(step), usePatchHrInsuranceEnrollment: mutation(patch),
    ApiError, isHrInsuranceConflict, owningListBack: () => '/hr/insurance', DependentsSection: {},
    canChangeHrInsuranceEnrollment, hrInsuranceEnrollmentBadge, hrInsurancePlanBadge, formatDate: (v: string) => v,
  }
  const component = new Function(...Object.keys(bindings), ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText)(...Object.values(bindings))
  return { state: component.setup({}, { expose: () => {}, emit: () => {} }), data, refetch }
}

describe('the enrollment record revisions', () => {
  it('ends with the revision the confirmation opened at and offers a reload on a conflict', async () => {
    const step = vi.fn().mockRejectedValue(new ApiError(409, 'conflict', 'changed'))
    const { state, data, refetch } = mount(step, vi.fn())
    state.openConfirm('end')
    data.value = enrollment(2)
    await state.confirmStep()
    expect(step).toHaveBeenCalledWith({ id: 5, step: 'end', revision: 1, dateEnd: undefined })
    expect(state.conflict.value).toBe(true)
    await state.reload()
    expect(refetch).toHaveBeenCalledOnce()
    expect(state.conflict.value).toBe(false)
  })

  it('saves the shares and notes with the revision the editor opened at', async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    const { state, data } = mount(vi.fn(), patch)
    state.startEdit()
    data.value = enrollment(2)
    await state.saveEdit()
    expect(patch).toHaveBeenCalledWith({ id: 5, body: { revision: 1, employee_share: 10, company_share: 20, notes: '' } })
  })
})
