import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message) }
}
const query = () => ({ data: Vue.ref(undefined), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() })

/** Runs one form's setup with its imports replaced by the bindings below. */
function setup(file: string, props: Record<string, unknown>, bindings: Record<string, unknown>) {
  const filename = resolve(import.meta.dirname, '..', file)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const code = compileScript(descriptor, { id: 'form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const all = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, nextTick: Vue.nextTick, onMounted: () => undefined,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), ApiError, ...bindings,
  }
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const component = new Function(...Object.keys(all), js)(...Object.values(all))
  const emit = vi.fn()
  return { state: component.setup(Vue.reactive(props), { expose: () => {}, emit }), emit }
}

const allocation = {
  id: 4, employee: { id: 7, name: 'Sara' }, leave_type: { id: 2, name: 'Annual' },
  number_of_days: 5, date_from: '2026-11-01', date_to: null, state: 'validate',
}

function allocationForm(update = vi.fn().mockResolvedValue(allocation), create = vi.fn()) {
  const employees = vi.fn((..._args: unknown[]) => query())
  const types = vi.fn((..._args: unknown[]) => query())
  const form = setup('LeaveAllocationForm.vue', { backTo: '/hr/leave/allocations', allocation }, {
    refDebounced: (value: unknown) => value, localIsoDay: () => '2026-10-28',
    useHrEmployees: employees, useHrLeaveTypes: types,
    useCreateLeaveAllocation: () => ({ mutateAsync: create, isPending: Vue.ref(false) }),
    useUpdateLeaveAllocation: () => ({ mutateAsync: update, isPending: Vue.ref(false) }),
  })
  return { ...form, update, create, employees, types }
}

describe('leave allocation edit', () => {
  it('starts from the grant, is clean until a field changes and patches only days and validity', async () => {
    const { state, update, create, emit, employees, types } = allocationForm()
    expect(Vue.toValue(employees.mock.calls[0]![1])).toBe(false)
    expect(Vue.toValue(types.mock.calls[0]![0])).toBe(false)
    expect(state.dirty.value).toBe(false)
    state.days.value = 8
    state.dateTo.value = '2027-01-31'
    expect(state.dirty.value).toBe(true)
    await state.submit()
    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({ id: 4, patch: { number_of_days: 8, date_from: '2026-11-01', date_to: '2027-01-31' } })
    expect(emit).toHaveBeenCalledWith('saved')
    expect(state.dirty.value).toBe(false)
  })

  it('keeps the draft and shows the server refusal on its field', async () => {
    const update = vi.fn().mockRejectedValue(new ApiError(422, 'invalid', 'below the days taken', 'number_of_days'))
    const { state, emit } = allocationForm(update)
    state.days.value = 1
    await state.submit()
    expect(emit).not.toHaveBeenCalled()
    expect(state.daysError.value).toBe('below the days taken')
    expect(state.dirty.value).toBe(true)
  })
})

const assignment = {
  id: 9, employee: { id: 7, name: 'Sara' }, schedule: { id: 3, name: 'Day' },
  date_start: '2026-11-01', date_end: '2026-11-30',
}

function assignmentForm(update = vi.fn().mockResolvedValue(assignment)) {
  const create = vi.fn()
  const form = setup('shifts/ShiftAssignmentForm.vue', { backTo: '/hr/shifts', employees: [], schedules: [], assignment }, {
    useCreateHrShiftAssignment: () => ({ mutateAsync: create, isPending: Vue.ref(false) }),
    useUpdateHrShiftAssignment: () => ({ mutateAsync: update, isPending: Vue.ref(false) }),
  })
  return { ...form, update, create }
}

describe('shift assignment edit', () => {
  it('patches the schedule and the range, an emptied end becoming an open end', async () => {
    const { state, update, create, emit } = assignmentForm()
    expect(state.dirty.value).toBe(false)
    state.pickSchedule('5')
    state.dateEnd.value = null
    expect(state.dirty.value).toBe(true)
    await state.submit()
    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({ id: 9, patch: { schedule_id: 5, date_start: '2026-11-01', date_end: null } })
    expect(emit).toHaveBeenCalledWith('saved')
  })

  it('names an overlapping period in words and keeps the draft', async () => {
    const update = vi.fn().mockRejectedValue(new ApiError(422, 'assignment_overlap', 'overlap', 'date_start'))
    const { state, emit } = assignmentForm(update)
    state.dateStart.value = '2026-10-01'
    await state.submit()
    expect(emit).not.toHaveBeenCalled()
    expect(state.fieldError('date_start')).toBe('hrShifts.form.overlap')
  })
})
