import { effectScope, ref, toValue } from 'vue'
import { QueryClient } from '@tanstack/vue-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HR_SHIFTS_PAGE_SIZE,
  hrShiftAssignmentQuery,
  hrShiftKeys,
  hrShiftScheduleQuery,
  useHrShiftSettings,
  usePatchHrShiftSettings,
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


let client: QueryClient
vi.mock('@tanstack/vue-query', async importOriginal => {
  const original = await importOriginal<typeof import('@tanstack/vue-query')>()
  return {
    ...original,
    useQuery: (options: unknown) => options,
    useQueryClient: () => client,
    useMutation: (options: unknown) => original.useMutation(options as never, client),
  }
})

type SettingsQuery = { enabled: unknown, queryKey: unknown, queryFn: () => Promise<unknown> }

describe('shift settings read capability', () => {
  const capabilities = ref<string[]>([])
  const identity = ref<{ id: number, company: { id: number } } | null>(null)
  const api = vi.fn()
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    capabilities.value = []
    identity.value = { id: 7, company: { id: 3 } }
    api.mockReset()
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
  it('keeps the successful full settings response in the identity cache without another GET', async () => {
    const key = [...hrShiftKeys.settings, { companyId: 3, userId: 7 }]
    const before = { day_reference: 'company', revision: 0 }
    const saved = { day_reference: 'user', revision: 1 }
    client.setQueryData(key, before)
    api.mockResolvedValueOnce(saved)
    const scope = effectScope()
    const mutation = scope.run(() => usePatchHrShiftSettings())!
    await mutation.mutateAsync({ day_reference: 'user', revision: 0 })
    expect(client.getQueryData(key)).toEqual(saved)
    expect(api).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('prevents an older in-flight GET from overwriting a successful save', async () => {
    const key = [...hrShiftKeys.settings, { companyId: 3, userId: 7 }]
    const before = { day_reference: 'company', revision: 0 }
    const saved = { day_reference: 'user', revision: 1 }
    client.setQueryData(key, before)
    let finishGet!: (value: typeof before) => void
    const oldResponse = new Promise<typeof before>(resolve => { finishGet = resolve })
    const reading = client.fetchQuery({ queryKey: key, queryFn: () => oldResponse }).catch(error => error)
    api.mockResolvedValueOnce(saved)
    const scope = effectScope()
    const mutation = scope.run(() => usePatchHrShiftSettings())!
    await mutation.mutateAsync({ day_reference: 'user', revision: 0 })
    expect(client.getQueryData(key)).toEqual(saved)
    finishGet(before)
    await reading
    expect(client.getQueryData(key)).toEqual(saved)
    scope.stop()
  })

  it('does not repopulate caches after identity changes during a save', async () => {
    let finish!: (value: unknown) => void
    api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const scope = effectScope()
    const mutation = scope.run(() => usePatchHrShiftSettings())!
    const saving = mutation.mutateAsync({ day_reference: 'user', revision: 0 })
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    identity.value = { id: 8, company: { id: 4 } }
    client.clear()
    finish({ day_reference: 'user', revision: 1 })
    await saving
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    scope.stop()
  })

})
