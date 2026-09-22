export function useVendorApi() {
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  async function request<T>(path: string, options: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}) {
    const url: string = `/api/vendor/v1/${path.replace(/^\/+/, '')}`
    return await $fetch<unknown>(url, {
      method: (options.method ?? 'GET') as any,
      body: options.body as any,
      query: options.query,
      headers,
    }) as T
  }
  return { request }
}
