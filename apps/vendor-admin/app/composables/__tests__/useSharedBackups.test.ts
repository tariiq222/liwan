import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSharedBackups } from '../useSharedBackups'

const tenant = '10000000-0000-4000-8000-000000000001'
afterEach(() => vi.unstubAllGlobals())

describe('useSharedBackups', () => {
  it('reads the listing of that one workspace under a key per workspace', async () => {
    const listing = { start: { allowed: true, reason: null, job_id: null }, total: 0, items: [] }
    const request = vi.fn(async () => listing)
    const useAsyncData = vi.fn(async (key: () => string, fetch: () => Promise<unknown>) => ({ key: key(), data: await fetch() }))
    vi.stubGlobal('useVendorApi', () => ({ request }))
    vi.stubGlobal('useAsyncData', useAsyncData)
    vi.stubGlobal('toValue', (value: unknown) => (typeof value === 'function' ? (value as () => unknown)() : value))
    const result = await useSharedBackups(tenant) as unknown as { key: string; data: unknown }
    expect(result).toEqual({ key: `vendor:tenant-backups:${tenant}`, data: listing })
    expect(request).toHaveBeenCalledWith(`shared/tenants/${tenant}/backups`)
  })
})
