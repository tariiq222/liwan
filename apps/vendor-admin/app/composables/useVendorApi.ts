type VendorRequestOptions = { method?: string; body?: unknown; query?: Record<string, unknown> }

/** The vendor console's calls to the BFF, paths relative to /api/vendor/v1; sign-in and step-up handling live in useAdminApi. */
export function useVendorApi() {
  const api = useAdminApi()
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  function request<T>(path: string, options: VendorRequestOptions = {}): Promise<T> {
    return api.request<T>(`/${path.replace(/^\/+/, '')}`, { ...options, headers })
  }
  return { request }
}
