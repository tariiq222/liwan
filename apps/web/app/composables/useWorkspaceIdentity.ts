import type { AccessIdentity } from '@/utils/accessPolicy'

/** UI-only combination. The vendor BFF and control service still authorize every request. */
export function useWorkspaceIdentity() {
  const { me } = useMe()
  const { capabilities } = useVendorContext()
  return computed<AccessIdentity>(() => me.value
    ? { ...me.value, vendorCapabilities: capabilities.value }
    : null)
}
