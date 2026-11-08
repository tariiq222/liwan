import { expect, it, vi } from 'vitest'
import { useCreateFinanceCreditNote, useCreateFinanceDebitNote } from '../useFinanceInvoices'
const state = vi.hoisted(() => ({ qc: null as any }))
vi.mock('@tanstack/vue-query', async original => ({ ...await original<any>(), useMutation: (options: any) => options, useQueryClient: () => state.qc }))

const note = { id: 7, name: 'INV/7' }

function harness() {
  const api = vi.fn(async () => note)
  vi.stubGlobal('useMe', () => ({ me: { value: null } }))
  vi.stubGlobal('useApi', () => ({ $api: api }))
  return api
}

/** Every request a form sends carries one key, so a retry replays the first note instead of creating a second one. */
it.each([
  ['debit note', useCreateFinanceDebitNote, 'debit-note'],
  ['credit note', useCreateFinanceCreditNote, 'credit-note'],
] as const)('sends one Idempotency-Key on every %s request', async (_label, hook, route) => {
  const api = harness()
  const mutation = hook() as any
  await mutation.mutationFn({ id: 5, body: {} })
  await mutation.mutationFn({ id: 5, body: {} })
  expect(api).toHaveBeenCalledTimes(2)
  const calls = api.mock.calls as unknown as [string, { method: string; headers: Record<string, string> }][]
  expect(calls.map(call => call[0])).toEqual([
    `/api/v1/finance/invoices/5/${route}`,
    `/api/v1/finance/invoices/5/${route}`,
  ])
  const [first, second] = calls.map(call => call[1].headers['Idempotency-Key'])
  expect(first).toBeTruthy()
  expect(second).toBe(first)
  expect(calls.every(call => call[1].method === 'POST')).toBe(true)
})

it('gives each form its own key, so two notes of one page do not collapse into one', async () => {
  const api = harness()
  const first = useCreateFinanceCreditNote() as any
  const second = useCreateFinanceCreditNote() as any
  await first.mutationFn({ id: 5, body: {} })
  await second.mutationFn({ id: 5, body: {} })
  const keys = (api.mock.calls as unknown as [string, { headers: Record<string, string> }][])
    .map(call => call[1].headers['Idempotency-Key'])
  expect(keys[0]).toBeTruthy()
  expect(keys[0]).not.toBe(keys[1])
})
