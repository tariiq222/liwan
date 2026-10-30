import type { Analytics } from '@liwan/commercial-contracts'

/** The executive analytics for one period; the control plane computes every figure. */
export function useVendorAnalytics() {
  const { request } = useVendorApi()
  return { load: (period: { from: string, to: string }) => request<Analytics>('commercial/analytics', { query: period }) }
}
