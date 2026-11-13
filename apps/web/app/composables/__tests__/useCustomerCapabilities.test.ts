import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCustomerCapabilities } from '../useSubscription'

// Plain vitest has no `@` alias: point the composable's two alias imports at their real files.
vi.mock('@/utils/customerCapabilities', async () => import('../../utils/customerCapabilities'))
vi.mock('@/utils/subscription', async () => import('../../utils/subscription'))

const withMe = (me: Record<string, unknown>) => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useMe', () => ({ me: ref(me) }))
  return useCustomerCapabilities()
}
const admin = { capabilities: ['settings.branding.manage', 'settings.company.vat.manage'] }
afterEach(() => vi.unstubAllGlobals())

describe('useCustomerCapabilities and workspace deletion', () => {
  it('keeps tenant.delete for the root company', () => {
    expect(withMe({ ...admin, is_root_company: true }).can('tenant.delete')).toBe(true)
  })
  it('drops tenant.delete in a branch, keeping the rest', () => {
    const { can } = withMe({ ...admin, is_root_company: false })
    expect(can('tenant.delete')).toBe(false)
    expect(can('subscription.manage')).toBe(true)
  })
  it('still drops the write capabilities for a read-only account', () => {
    const { can } = withMe({ ...admin, read_only: true })
    expect(['tenant.delete', 'subscription.manage', 'branches.manage'].some(can)).toBe(false)
  })
})
