import { ref, toValue } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HR_SHIFTS_PAGE_SIZE,
  hrShiftAssignmentQuery,
  hrShiftKeys,
  hrShiftScheduleQuery,
  useHrShiftSettings,
} from '../useHrShifts'

const SCHEDULE_PARAMS = { active: 'true' as const, limit: HR_SHIFTS_PAGE_SIZE, offset: 0 }
const ASSIGNMENT_PARAMS = { employee_id: null, schedule_id: null, on_date: null, limit: HR_SHIFTS_PAGE_SIZE, offset: 0 }

describe('hr shifts query keys and queries', () => {
  it('shares one root so one write refreshes every shifts list', () => {
    expect(hrShiftKeys.schedules(SCHEDULE_PARAMS).slice(0, 2)).toEqual(hrShiftKeys.all)
    expect(hrShiftKeys.schedule(4).slice(0, 2)).toEqual(hrShiftKeys.all)
    expect(hrShiftKeys.assignments(ASSIGNMENT_PARAMS).slice(0, 2)).toEqual(hrShiftKeys.all)
    expect(hrShiftKeys.mine.slice(0, 2)).toEqual(hrShiftKeys.all)
  })

  it('names the schedule and the assignment of one id apart', () => {
    expect(hrShiftKeys.schedule(4)).toEqual(['hr', 'shifts', 'schedule', 4])
    expect(hrShiftKeys.schedules(SCHEDULE_PARAMS)).toEqual(['hr', 'shifts', 'schedules', SCHEDULE_PARAMS])
  })

  it('sends the active filter only when it leaves the active-only default', () => {
    expect(hrShiftScheduleQuery(SCHEDULE_PARAMS)).toEqual({ active: undefined, limit: HR_SHIFTS_PAGE_SIZE, offset: 0 })
    expect(hrShiftScheduleQuery({ ...SCHEDULE_PARAMS, active: 'false' }).active).toBe('false')
    expect(hrShiftScheduleQuery({ ...SCHEDULE_PARAMS, active: 'all' }).active).toBe('all')
  })

  it('omits every unset assignment filter and keeps the page', () => {
    expect(hrShiftAssignmentQuery(ASSIGNMENT_PARAMS)).toEqual({
      employee_id: undefined,
      schedule_id: undefined,
      on_date: undefined,
      limit: HR_SHIFTS_PAGE_SIZE,
      offset: 0,
    })
    expect(hrShiftAssignmentQuery({ employee_id: 7, schedule_id: 3, on_date: '2026-11-15', limit: 25, offset: 50 }))
      .toEqual({ employee_id: 7, schedule_id: 3, on_date: '2026-11-15', limit: 25, offset: 50 })
  })
})


vi.mock('@tanstack/vue-query', async importOriginal => ({
  ...await importOriginal<object>(),
  useQuery: (options: unknown) => options,
}))

type SettingsQuery = { enabled: unknown, queryKey: unknown, queryFn: () => Promise<unknown> }

describe('shift settings read capability', () => {
  const capabilities = ref<string[]>([])
  const identity = ref<{ id: number, company: { id: number } } | null>(null)
  const api = vi.fn()
  beforeEach(() => {
    capabilities.value = []
    identity.value = { id: 7, company: { id: 3 } }
    api.mockResolvedValue({ day_reference: 'company' })
    vi.stubGlobal('useApi', () => ({ $api: api }))
    vi.stubGlobal('useMe', () => ({ me: identity }))
    vi.stubGlobal('useAccess', () => ({ can: (key: string) => capabilities.value.includes(key) }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['hr.employees.read', 'hr.shifts.manage'])('allows %s independently', async capability => {
    capabilities.value = [capability]
    const query = useHrShiftSettings() as unknown as SettingsQuery
    expect(toValue(query.enabled)).toBe(true)
    await query.queryFn()
    expect(api).toHaveBeenCalledWith('/api/v1/hr/shifts/settings', expect.objectContaining({ schema: expect.anything() }))
    capabilities.value = []
    expect(toValue(query.enabled)).toBe(false)
  })

  it('retains identity and caller-enabled guards and denies unrelated shifts read', () => {
    capabilities.value = ['hr.shifts.read']
    const enabled = ref(true)
    const query = useHrShiftSettings(enabled) as unknown as SettingsQuery
    expect(toValue(query.enabled)).toBe(false)
    capabilities.value = ['hr.shifts.manage']
    expect(toValue(query.enabled)).toBe(true)
    expect(toValue(query.queryKey)).toEqual(['hr', 'shifts', 'settings', { companyId: 3, userId: 7 }])
    enabled.value = false
    expect(toValue(query.enabled)).toBe(false)
    enabled.value = true
    identity.value = null
    expect(toValue(query.enabled)).toBe(false)
  })
})
