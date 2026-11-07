import { expect, it, vi } from 'vitest'
import type { FinanceInvoicePatch } from '@liwan/contracts'
import { QueryClient } from '@tanstack/vue-query'
import { usePatchFinanceInvoice, financeInvoiceKeys } from '../useFinanceInvoices'
const state = vi.hoisted(() => ({ qc: null as any }))
vi.mock('@tanstack/vue-query', async original => ({ ...await original<any>(), useMutation: (options: any) => options, useQueryClient: () => state.qc }))
it('seeds the committed invoice answer and completes without waiting for list reads', async () => {
  const qc = new QueryClient()
  state.qc = qc
  vi.stubGlobal('useMe', () => ({ me: { value: null } }))
  vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
  const m = usePatchFinanceInvoice() as any
  const invoice = { id: 9, name: 'INV/9' }
  const result = m.onSuccess(invoice, { id: 9, body: {} })
  expect(qc.getQueryData(financeInvoiceKeys.record(9))).toEqual(invoice)
  expect(result).toBeUndefined()
  qc.clear()
})
it('the mutation resolves while a mounted list refresh is still pending', async () => {
  const { QueryObserver, MutationObserver } = await import('@tanstack/vue-query')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  state.qc = qc
  const invoice = { id: 9, name: 'INV/9' }
  vi.stubGlobal('useMe', () => ({ me: { value: null } }))
  vi.stubGlobal('useApi', () => ({ $api: vi.fn(async () => invoice) }))
  const key = financeInvoiceKeys.list({ q: '' } as any)
  qc.setQueryData(key, { items: [], total: 0 })
  let starts = 0
  const observer = new QueryObserver(qc, { queryKey: key, staleTime: Infinity, queryFn: () => { starts++; return new Promise(() => {}) } })
  const stop = observer.subscribe(() => {})
  const options = usePatchFinanceInvoice() as any
  const mutation = new MutationObserver<{ id: number; name: string }, Error, { id: number; body: FinanceInvoicePatch }, string>(qc, options)
  await expect(mutation.mutate({ id: 9, body: {} })).resolves.toEqual(invoice)
  await vi.waitFor(() => expect(starts).toBe(1))
  expect(qc.getQueryData(financeInvoiceKeys.record(9))).toEqual(invoice)
  expect(qc.getQueryState(key)?.fetchStatus).toBe('fetching')
  stop(); qc.clear()
})
it('does not seed a committed old-company answer into the newly selected company', async () => {
  const qc = new QueryClient(); state.qc = qc
  const me = { value: { id: 1, company: { id: 2 } } }
  vi.stubGlobal('useMe', () => ({ me })); vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
  const m = usePatchFinanceInvoice() as any
  const owner = m.onMutate()
  me.value = { id: 1, company: { id: 3 } }
  m.onSuccess({ id: 9, name: 'OLD' }, { id: 9, body: {} }, owner)
  expect(qc.getQueryData(financeInvoiceKeys.record(9))).toBeUndefined()
  qc.clear()
})
