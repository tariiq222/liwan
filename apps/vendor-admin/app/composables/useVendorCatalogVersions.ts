import { catalogActionPath, type CatalogVersion, type CatalogVersionAction } from '@/utils/vendorCatalogVersions'

/** The catalog versions the control plane holds (imported from the server) and the two steps that publish one. */
export function useVendorCatalogVersions() {
  const { request } = useVendorApi()
  const list = () => request<{ items: CatalogVersion[], total: number }>('catalog').then(envelope => envelope.items)
  return {
    /** One cache key for every page of the section, so a step taken on a record shows on the list and in the bundle form. */
    load: () => useAsyncData('vendor:catalog-versions', list),
    /** Publishing needs a fresh passkey confirmation; useAdminApi asks for it and repeats the request. */
    act: (id: string, action: CatalogVersionAction, reason: string) => request<CatalogVersion>(catalogActionPath(id, action), { method: 'POST', body: { reason } }),
  }
}
