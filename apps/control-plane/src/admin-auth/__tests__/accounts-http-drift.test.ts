import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { accountsHttp } from '../accounts-http.js'

const fail = (status: number, code: string) => Object.assign(new Error(code), { status, code })
const call = (pathname: string, rows: unknown[]) => accountsHttp({ query: async () => ({ rowCount: rows.length, rows }) } as unknown as Pool, {
  method: 'GET', pathname, raw: '', fail,
  auth: { actor: 1, capabilities: ['vendor.accounts.manage'], stepUpFresh: true, method: 'GET' },
  requireCapability: () => undefined,
})

describe('contract drift on the control plane side', () => {
  it('answers 503 admin_unavailable, not 422, when a stored row no longer fits the response contract', async () => {
    await expect(call('/v1/admin/me', [{ id: 1, email: 'a@nasq.sa', display_name: 'A', roles: ['not-a-role'] }])).rejects.toMatchObject({ status: 503, code: 'admin_unavailable' })
    await expect(call('/v1/admin/accounts', [{ id: 1, email: 'a@nasq.sa', display_name: 'A', status: 'gone', roles: [], passkeys: 0, last_seen_at: null }])).rejects.toMatchObject({ status: 503, code: 'admin_unavailable' })
  })
})
