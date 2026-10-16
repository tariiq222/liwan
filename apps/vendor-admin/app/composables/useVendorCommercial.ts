import type { PricingPolicy, Quote } from '@webvue/commercial-contracts'
import type { BundleView, CatalogReleaseView, CommercialKind, LifecycleAction, VendorListEnvelope, PlanView, StatusFilter } from '@/utils/vendorCommercial'
import { lifecycleBody, lifecycleUrl } from '@/utils/vendorCommercial'

export type PricingPolicyView = PricingPolicy
export type ListParams = { status?: StatusFilter; q?: string; limit?: number; offset?: number }

/** Typed access to the commercial endpoints through the vendor proxy. All totals and prices come from the server. */
export function useVendorCommercial() {
  const { request } = useVendorApi()
  const seg = (kind: CommercialKind) => (kind === 'bundle' ? 'bundles' : 'plans')
  const query = (p: ListParams) => ({ status: p.status && p.status !== 'all' ? p.status : undefined, q: p.q || undefined, limit: p.limit, offset: p.offset })
  return {
    releases: () => request<VendorListEnvelope<CatalogReleaseView>>('commercial/catalog/releases').then(r => r.items),
    createRelease: (body: { catalog_version: string; reason: string }) => request<CatalogReleaseView>('commercial/catalog/releases', { method: 'POST', body }),
    policies: () => request<VendorListEnvelope<PricingPolicyView>>('commercial/policies').then(r => r.items[0]),
    listBundles: (p: ListParams = {}) => request<VendorListEnvelope<BundleView>>('commercial/bundles', { query: query(p) }),
    /** The server filters only by name substring and status, not bundle_id; renamed versions need the unfiltered list, so page through it. */
    bundleVersions: async (bundleId: string) => {
      const out: BundleView[] = []
      for (let offset = 0; offset < 5000; offset += 200) {
        const page = await request<VendorListEnvelope<BundleView>>('commercial/bundles', { query: { status: undefined, limit: 200, offset } })
        out.push(...page.items.filter(v => v.bundle_id === bundleId))
        if (offset + 200 >= page.total) break
      }
      return out.sort((a, b) => b.version - a.version)
    },
    listPlans: (p: ListParams = {}) => request<VendorListEnvelope<PlanView>>('commercial/plans', { query: query(p) }),
    get: <T extends BundleView | PlanView>(kind: CommercialKind, id: string) => request<T>(`commercial/${seg(kind)}/${encodeURIComponent(id)}`),
    create: <T extends BundleView | PlanView>(kind: CommercialKind, body: unknown) => request<T>(`commercial/${seg(kind)}`, { method: 'POST', body }),
    update: <T extends BundleView | PlanView>(kind: CommercialKind, id: string, body: unknown) => request<T>(`commercial/${seg(kind)}/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    act: <T>(kind: CommercialKind, id: string, action: LifecycleAction, editRevision: number, reason: string) => {
      const { path, method } = lifecycleUrl(kind, id, action)
      return request<T>(path, { method, body: lifecycleBody(editRevision, reason) })
    },
    quote: (body: unknown) => request<Quote>('commercial/quotes', { method: 'POST', body }),
  }
}
