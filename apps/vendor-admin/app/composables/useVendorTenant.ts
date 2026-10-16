import type { MaybeRefOrGetter } from 'vue'
import type { VendorTenant } from '@/utils/vendorTenant'

/** One tenant record (null for an empty id: a customer without a workspace). Calls with the same id share the data, so a page and its panels read and refresh the same copy. */
export function useVendorTenant(id: MaybeRefOrGetter<string>) {
  const { request } = useVendorApi()
  return useAsyncData(() => `vendor:tenant:${toValue(id)}`, async () => (toValue(id) ? request<VendorTenant>(`tenants/${encodeURIComponent(toValue(id))}`) : null))
}
