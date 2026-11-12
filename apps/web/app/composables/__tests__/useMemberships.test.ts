import { ref, toValue } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { membershipKeys, useAddMembership, useMembershipBranches, useMemberships, useRemoveMembership, useUpdateMembershipRoles } from '../useMemberships'

const mocks = vi.hoisted(() => ({ api: vi.fn(async () => ({ items: [], total: 0 })), invalidate: vi.fn(async () => undefined), refresh: vi.fn(async () => undefined) }))
vi.mock('@tanstack/vue-query', () => ({
  useQuery: (options: unknown) => options, useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}))
vi.mock('../useAdminUsers', () => ({ ACCESS_MUTATION_GC_TIME: 0 }))
type Query = { queryKey: { value: unknown[] }, queryFn: (context: { signal?: AbortSignal }) => Promise<unknown>, enabled: Parameters<typeof toValue>[0] }
type Mutation = { mutationFn: (variables: unknown) => Promise<unknown>, onSuccess: () => Promise<void> }

function stub(companyId = 1) {
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  vi.stubGlobal('useMe', () => ({ me: ref({ company: { id: companyId } }) }))
  vi.stubGlobal('refreshNuxtData', mocks.refresh)
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('membership calls', () => {
  it('lists the working company\'s members, keyed by the company the list belongs to', async () => {
    stub(1)
    const own = useMemberships(undefined) as unknown as Query
    const branch = useMemberships(7) as unknown as Query
    expect(own.queryKey.value).toEqual(membershipKeys.list(1, undefined))
    expect(branch.queryKey.value).not.toEqual(own.queryKey.value)
    expect(branch.queryKey.value).toContain(7)
    await branch.queryFn({})
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/admin/memberships', expect.objectContaining({ query: { company_id: 7, limit: 200, offset: 0 } }))
    expect(toValue(own.enabled as never)).toBe(true)
  })

  it('reads every page of a long list and answers one list', async () => {
    stub(1)
    const members = Array.from({ length: 450 }, (_, id) => ({ id }))
    mocks.api.mockImplementation((async (_path: string, options: { query: { limit: number; offset: number } }) => ({ items: members.slice(options.query.offset, options.query.offset + options.query.limit), total: 450 })) as never)
    const controller = new AbortController()
    const result = await (useMemberships(7) as unknown as Query).queryFn({ signal: controller.signal })
    expect(mocks.api.mock.calls.map(call => (call as unknown as [string, { query: unknown; signal: unknown }])[1].query)).toEqual([
      { company_id: 7, limit: 200, offset: 0 }, { company_id: 7, limit: 200, offset: 200 }, { company_id: 7, limit: 200, offset: 400 },
    ])
    expect(mocks.api.mock.calls.every(call => (call as unknown as [string, { signal: unknown }])[1].signal === controller.signal)).toBe(true)
    expect(result).toEqual({ items: members, total: 450 })
    mocks.api.mockImplementation((async () => ({ items: [], total: 0 })) as never)
  })

  it('lists every branch below the root, page by page, under the membership key of the working company', async () => {
    stub(1)
    const branches = Array.from({ length: 250 }, (_, id) => ({ id: id + 2, name: `B${id}` }))
    mocks.api.mockImplementation((async (_path: string, options: { query: { limit: number; offset: number } }) => ({ items: branches.slice(options.query.offset, options.query.offset + options.query.limit), total: 250 })) as never)
    const query = useMembershipBranches(true) as unknown as Query
    expect(query.queryKey.value).toEqual(membershipKeys.branches(1))
    expect(query.queryKey.value.slice(0, membershipKeys.all.length)).toEqual([...membershipKeys.all])
    expect(membershipKeys.branches(1)).not.toEqual(membershipKeys.branches(2))
    expect(await query.queryFn({})).toEqual({ items: branches, total: 250 })
    expect(mocks.api.mock.calls.map(call => [(call as unknown as [string])[0], (call as unknown as [string, { query: unknown }])[1].query])).toEqual([
      ['/api/v1/admin/memberships/branches', { limit: 200, offset: 0 }], ['/api/v1/admin/memberships/branches', { limit: 200, offset: 200 }],
    ])
    expect(toValue(query.enabled as never)).toBe(true)
    expect(toValue((useMembershipBranches(false) as unknown as Query).enabled as never)).toBe(false)
    mocks.api.mockImplementation((async () => ({ items: [], total: 0 })) as never)
  })

  it('never shows the previous list while another company\'s loads', () => {
    stub(1)
    expect(useMemberships(undefined)).not.toHaveProperty('placeholderData')
  })

  it('keeps the same branch in two working companies apart', () => {
    expect(membershipKeys.list(1, 7)).not.toEqual(membershipKeys.list(2, 7))
  })

  it('adds, changes and removes through the membership routes', async () => {
    stub()
    await (useAddMembership() as unknown as Mutation).mutationFn({ login: 'a@example.com', assignments: [], company_id: 7 })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/admin/memberships', expect.objectContaining({ method: 'POST', body: { login: 'a@example.com', assignments: [], company_id: 7 } }))
    await (useUpdateMembershipRoles() as unknown as Mutation).mutationFn({ id: 21, body: { expected_version: 'v1', assignments: [] } })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/admin/memberships/21', expect.objectContaining({ method: 'PATCH', body: { expected_version: 'v1', assignments: [] } }))
    await (useRemoveMembership() as unknown as Mutation).mutationFn({ id: 21, companyId: 7 })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/admin/memberships/21', { method: 'DELETE', query: { company_id: 7 } })
  })

  it('refetches the member lists, the access log and the identity after a change', async () => {
    stub()
    await (useRemoveMembership() as unknown as Mutation).onSuccess()
    expect(mocks.refresh).toHaveBeenCalledWith('me')
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: membershipKeys.all })
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['access', 'audit'] })
  })
})
