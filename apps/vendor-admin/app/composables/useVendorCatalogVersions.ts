import { catalogActionPath, type CatalogVersion, type CatalogVersionAction } from '@/utils/vendorCatalogVersions'

/** The catalog versions the control plane holds (imported from the server) and the two steps that publish one. */
export function useVendorCatalogVersions() {
  const { request } = useVendorApi()
  const list = () => request<{ items: CatalogVersion[], total: number }>('catalog').then(envelope => envelope.items)
  return {
    /** One cache key for every page of the section, so a step taken on a record shows on the list and in the bundle form. A page that does not need the versions passes `false` and reads nothing. */
    load: (needed = true) => useAsyncData('vendor:catalog-versions', () => (needed ? list() : Promise.resolve([]))),
    /** Publishing needs a fresh passkey confirmation; useAdminApi asks for it and repeats the request. */
    act: (id: string, action: CatalogVersionAction, reason: string) => request<CatalogVersion>(catalogActionPath(id, action), { method: 'POST', body: { reason } }),
  }
}
