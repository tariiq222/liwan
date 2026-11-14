import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SalesOrderListSchema, SalesOrderSchema, SalesSettingsSchema } from '@liwan/contracts'

// vue-query is replaced by the options each composable hands it, so the request each one sends can be read and run.
const setQueryData = vi.fn()
const invalidateQueries = vi.fn()
vi.mock('@tanstack/vue-query', () => ({
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ setQueryData, invalidateQueries }),
  keepPreviousData: 'keep',
}))

const $api = vi.fn()
const { useSalesOrders, useSalesOrder, useCreateSalesOrder, useUpdateSalesOrder, useSalesTransition, useAssignSalesOrder, useDuplicateSalesOrder } = await import('../useSalesOrders')
const { useSalesSettings, useSaveSalesSettings } = await import('../useSalesSettings')

type Options = { queryFn: () => Promise<unknown>; queryKey: { value: readonly unknown[] } | readonly unknown[]; enabled?: { value: boolean }; mutationFn: (args: unknown) => Promise<unknown>; onSuccess: (saved: { id: number }) => Promise<void>; onError: (failure: unknown, args: unknown) => Promise<void> }
const as = (value: unknown) => value as Options

beforeEach(() => {
  $api.mockReset()
  setQueryData.mockReset()
  invalidateQueries.mockReset()
  vi.stubGlobal('useApi', () => ({ $api }))
  vi.stubGlobal('useMe', () => ({ me: { value: { company: { id: 4 } } } }))
})

describe('sales reads', () => {
  it('lists a page with its filters under the contract schema', async () => {
    const state = { q: 'x', stage: 'orders' as const, source: null, mine: true, page: 2 }
    const query = as(useSalesOrders(state))
    await query.queryFn()
    expect($api).toHaveBeenCalledWith('/api/v1/sales/orders', { query: { q: 'x', state: 'confirmed', mine: 'true', limit: 25, offset: 25 }, schema: SalesOrderListSchema })
    expect((query.queryKey as { value: unknown[] }).value).toEqual(['sales', 'list', state])
  })

  it('reads one order and the settings', async () => {
    const order = as(useSalesOrder(7))
    await order.queryFn()
    expect($api).toHaveBeenCalledWith('/api/v1/sales/orders/7', { schema: SalesOrderSchema })
    expect(as(useSalesOrder(null)).enabled?.value).toBe(false)
    const settings = as(useSalesSettings())
    await settings.queryFn()
    expect($api).toHaveBeenCalledWith('/api/v1/sales/settings', { schema: SalesSettingsSchema })
    expect((settings.queryKey as { value: unknown[] }).value).toEqual(['sales', 'settings', { companyId: 4 }])
  })
})

describe('sales writes', () => {
  it('sends each write to its route with the contract schema', async () => {
    await as(useCreateSalesOrder()).mutationFn({ customer_id: 5 })
    expect($api).toHaveBeenLastCalledWith('/api/v1/sales/orders', { method: 'POST', body: { customer_id: 5 }, schema: SalesOrderSchema })
    await as(useUpdateSalesOrder()).mutationFn({ id: 7, patch: { terms: 'x' } })
    expect($api).toHaveBeenLastCalledWith('/api/v1/sales/orders/7', { method: 'PATCH', body: { terms: 'x' }, schema: SalesOrderSchema })
    await as(useSalesTransition()).mutationFn({ id: 7, transition: 'confirm' })
    expect($api).toHaveBeenLastCalledWith('/api/v1/sales/orders/7/confirm', { method: 'POST', schema: SalesOrderSchema })
    await as(useAssignSalesOrder()).mutationFn({ id: 7, salespersonId: 8 })
    expect($api).toHaveBeenLastCalledWith('/api/v1/sales/orders/7/assign', { method: 'POST', body: { salesperson_id: 8 }, schema: SalesOrderSchema })
    await as(useDuplicateSalesOrder()).mutationFn(7)
    expect($api).toHaveBeenLastCalledWith('/api/v1/sales/orders/7/duplicate', { method: 'POST', schema: SalesOrderSchema })
  })

  it('replaces the record with the answer and refetches the lists only', async () => {
    const saved = { id: 7 }
    await as(useSalesTransition()).onSuccess(saved)
    expect(setQueryData).toHaveBeenCalledWith(['sales', 'order', 7], saved)
    const { predicate } = invalidateQueries.mock.calls[0]![0] as { predicate: (query: { queryKey: readonly unknown[] }) => boolean }
    expect(predicate({ queryKey: ['sales', 'list', {}] })).toBe(true)
    expect(predicate({ queryKey: ['sales', 'order', 7] })).toBe(false)
    expect(predicate({ queryKey: ['sales', 'settings', {}] })).toBe(false)
  })

  it('refetches the record after a refused write on it, so its actions follow the server', async () => {
    const refused = new Error('transition_forbidden')
    await as(useSalesTransition()).onError(refused, { id: 7, transition: 'confirm' })
    await as(useUpdateSalesOrder()).onError(refused, { id: 8, patch: {} })
    await as(useAssignSalesOrder()).onError(refused, { id: 9, salespersonId: 2 })
    await as(useDuplicateSalesOrder()).onError(refused, 10)
    expect(invalidateQueries.mock.calls.map(call => call[0])).toEqual([7, 8, 9, 10].map(id => ({ queryKey: ['sales', 'order', id] })))
    await as(useCreateSalesOrder()).onError(refused, { customer_id: 5 })
    expect(invalidateQueries).toHaveBeenCalledTimes(4)
  })

  it('saves the settings with the revision and replaces the cached ones', async () => {
    const saved = { visibility: 'all', revision: 3 }
    $api.mockResolvedValue(saved)
    await expect(as(useSaveSalesSettings()).mutationFn({ visibility: 'all', revision: 2 })).resolves.toBe(saved)
    expect($api).toHaveBeenCalledWith('/api/v1/sales/settings', { method: 'PATCH', body: { visibility: 'all', revision: 2 }, schema: SalesSettingsSchema })
    expect(setQueryData).toHaveBeenCalledWith(['sales', 'settings', { companyId: 4 }], saved)
  })
})
