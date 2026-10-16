import type { MaybeRefOrGetter } from 'vue'
import type { VendorTenant } from '@/utils/vendorTenant'

/** One tenant record. Calls with the same id share the data, so a page and its panels read and refresh the same copy. */
export function useVendorTenant(id: MaybeRefOrGetter<string>) {
  const { request } = useVendorApi()
  return useAsyncData(() => `vendor:tenant:${toValue(id)}`, () => request<VendorTenant>(`tenants/${encodeURIComponent(toValue(id))}`))
}
