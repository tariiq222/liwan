import { describe, expect, it } from 'vitest'
import { controlTenantForSigned } from './signed-tenant.js'

const CONTROL = '0b6f1c3e-5d2a-4f7e-9a41-2c8d7e6b5a10'
const UUID_SHAPED_SLUG = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

/** Records each lookup and answers it with the given row. The SQL conditions themselves are proven against PostgreSQL in commercial-invitations.test.ts. */
function fakeDb(row: Record<string, string> | null) {
  const asked: Array<{ sql: string; value: unknown }> = []
  const db = { async query(sql: string, params: unknown[]) { asked.push({ sql, value: params[0] }); return { rows: row ? [row] : [] } } } as never
  return { db, asked }
}

describe('controlTenantForSigned routing', () => {
  it('sends a UUID-shaped value, even one the registry id pattern admits, to the control tenant lookup only', async () => {
    for (const value of [CONTROL, UUID_SHAPED_SLUG]) {
      const { db, asked } = fakeDb({ id: value })
      expect(await controlTenantForSigned(db, value)).toBe(value)
      expect(asked).toHaveLength(1)
      expect(asked[0].sql).toContain('FROM tenants')
      expect(asked[0].value).toBe(value)
    }
  })
  it('sends a registry slug to the binding lookup only', async () => {
    const { db, asked } = fakeDb({ control_tenant_id: CONTROL })
    expect(await controlTenantForSigned(db, 'tshared')).toBe(CONTROL)
    expect(asked).toHaveLength(1)
    expect(asked[0].sql).toContain('FROM shared_registry_bindings')
  })
  it('answers null when the lookup finds no row', async () => {
    expect(await controlTenantForSigned(fakeDb(null).db, CONTROL)).toBeNull()
    expect(await controlTenantForSigned(fakeDb(null).db, 'tshared')).toBeNull()
  })
  it('answers null without any lookup for a value that is neither a UUID nor a registry id', async () => {
    const { db, asked } = fakeDb({ id: CONTROL })
    expect(await controlTenantForSigned(db, 'Not A Slug')).toBeNull()
    expect(asked).toEqual([])
  })
})
