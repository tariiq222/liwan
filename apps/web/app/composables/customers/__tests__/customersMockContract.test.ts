import { describe, expect, it } from 'vitest'
import { CustomerPickListSchema } from '@liwan/contracts'
import { handleCustomers } from '../../../../e2e/customers-mock-routes.mjs'

// The customers mock answers the pick list in the contract's shape, so the pickers cannot drift from the server.
async function pick(query = '', cookie = ''): Promise<{ status: number; body: unknown }> {
  let answer: { status: number; body: unknown } | undefined
  const url = new URL(`http://mock.example.test/api/v1/customers/pick${query}`)
  const handled = await handleCustomers(
    { method: 'GET', headers: { cookie } },
    {},
    url.pathname,
    url,
    { json: (_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload } }, readBody: async () => '{}' },
  )
  expect(handled).toBe(true)
  return answer as { status: number; body: unknown }
}

describe('customers pick mock', () => {
  it('lists the active customers with their kind and the last four digits of the phone only', async () => {
    const all = CustomerPickListSchema.parse((await pick()).body)
    expect(all.items.map(item => item.id)).toEqual([1, 2, 3])
    expect(all.items[1]).toEqual({ id: 2, name: 'مؤسسة النخيل', is_company: true, phone_last4: '0002' })
  })

  it('searches by name and pages with limit and offset', async () => {
    expect(CustomerPickListSchema.parse((await pick('?q=النخيل')).body).items.map(item => item.id)).toEqual([2])
    const page = CustomerPickListSchema.parse((await pick('?limit=1&offset=1')).body)
    expect(page).toMatchObject({ total: 3 })
    expect(page.items.map(item => item.id)).toEqual([2])
  })

  it('answers a read-only session, which keeps customers.read', async () => {
    expect((await pick('', 'mock_caps=reader')).status).toBe(200)
  })
})
