import { computed, ref, toValue } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHrLeaveBalances, useHrLeaveRequests, useMyHrLeaveRequest } from '../useHrLeave'
import { useMyHrProfile } from '../useMyHrProfile'

// Capture Vue Query's boundary while running the real HR composables: the API calls, schemas,
// id validation, and reactive enabled predicates remain production code.
vi.mock('@tanstack/vue-query', async importOriginal => ({
  ...await importOriginal<object>(),
  useQuery: (options: unknown) => options,
}))

type CapturedQuery = { queryFn: () => Promise<unknown>; queryKey: unknown; enabled: unknown }
const identity = ref<{id:number,company:{id:number}} | null>({id:2,company:{id:1}})
beforeEach(() => {
  identity.value = {id:2,company:{id:1}}
  vi.stubGlobal('useMe', () => ({me:identity}))
})
afterEach(() => vi.unstubAllGlobals())

describe('Self-service HR queries', () => {
  it('uses only the owned leave endpoint and keeps own/admin query caches separate', async () => {
    const calls: string[] = []
    vi.stubGlobal('useApi', () => ({ $api: async (path: string) => { calls.push(path); return {id:7} } }))
    const id = ref<number | null>(7)
    const query = useMyHrLeaveRequest(id) as unknown as CapturedQuery
    await query.queryFn()
    expect(calls).toEqual(['/api/v1/hr/leave/me/7'])
    expect(toValue(query.queryKey)).toEqual(['hr','leave','me',7,{companyId:1,userId:2}])
    id.value = null
    expect(toValue(query.enabled)).toBe(false)
  })
  it('resolves the employee from the server without accepting a route employee selector', async () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const allowed = ref(true)
    vi.stubGlobal('useApi', () => ({ $api: async (path: string, options: Record<string, unknown>) => { calls.push([path, options]); return null } }))
    vi.stubGlobal('useAccess', () => ({can: (capability: string) => allowed.value && capability === 'hr.employees.read'}))
    const query = useMyHrProfile() as unknown as CapturedQuery
    expect(await query.queryFn()).toBeNull()
    expect(calls[0]![0]).toBe('/api/v1/hr/me')
    expect(calls[0]![1]).not.toHaveProperty('query')
    allowed.value = false
    expect(toValue(query.enabled)).toBe(false)
  })
  it('never enables an own shift read without employee read access', async () => {
    const { useMyHrShiftAssignments } = await import('../useHrShifts')
    vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
    vi.stubGlobal('useAccess', () => ({can: () => false}))
    const query = useMyHrShiftAssignments(computed(() => true)) as unknown as CapturedQuery
    expect(toValue(query.enabled)).toBe(false)
  })
  it('changes every personal HR cache key immediately on company and user changes and disables reads on logout', async () => {
    const { useMyHrAssets } = await import('../useHrAssets')
    const { useMyHrPayslips, useMyHrPayslip } = await import('../useHrPayslips')
    const { useMyHrShiftAssignments } = await import('../useHrShifts')
    vi.stubGlobal('useApi', () => ({$api:vi.fn()}))
    vi.stubGlobal('useAccess', () => ({can:() => true}))
    const queries = [useMyHrProfile(), useMyHrLeaveRequest(ref(7)), useHrLeaveBalances(), useHrLeaveRequests({scope:'mine',limit:25,offset:0}), useMyHrAssets(), useMyHrPayslips(), useMyHrPayslip(ref(7)), useMyHrShiftAssignments()] as unknown as CapturedQuery[]
    const firstKeys = queries.map(query => toValue(query.queryKey))
    identity.value = {id:2,company:{id:3}}
    const secondKeys = queries.map(query => toValue(query.queryKey))
    expect(secondKeys.every((key,index) => JSON.stringify(key) !== JSON.stringify(firstKeys[index]))).toBe(true)
    expect(secondKeys.every((key:any) => key.at(-1).companyId === 3 && key.at(-1).userId === 2)).toBe(true)
    identity.value = {id:9,company:{id:3}}
    const thirdKeys = queries.map(query => toValue(query.queryKey))
    expect(thirdKeys.every((key,index) => JSON.stringify(key) !== JSON.stringify(secondKeys[index]))).toBe(true)
    expect(thirdKeys.every((key:any) => key.at(-1).companyId === 3 && key.at(-1).userId === 9)).toBe(true)
    identity.value = null
    expect(queries.map(query => toValue(query.enabled))).toEqual([false,false,false,false,false,false,false,false])
  })

})
