import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import type { BundleView, PlanView } from './vendorCommercial'

/** The catalog section's tabs, in the order things are built (applications, their versions, bundles of them, plans of bundles): each keeps its own URL (links elsewhere point at them) and its own list filters. */
export const CATALOG_TABS = [
  { key: 'catalog', to: '/catalog', labelKey: 'vendor.catalog.applications' },
  { key: 'releases', to: '/catalog/releases', labelKey: 'vendor.catalog.releases' },
  { key: 'bundles', to: '/bundles', labelKey: 'vendor.bundles.title' },
  { key: 'plans', to: '/plans', labelKey: 'vendor.plans.title' },
] as const

export type CatalogTabKey = (typeof CATALOG_TABS)[number]['key']
export type CatalogTab = (typeof CATALOG_TABS)[number]

// `/catalog/releases` sits under `/catalog`, so the longest prefix decides; a flat order would call it the applications tab.
const TABS_BY_SPECIFICITY = [...CATALOG_TABS].sort((a, b) => b.to.length - a.to.length)

/** The tab whose path prefix contains `path`; null outside the catalog section. */
export function catalogTabOf(path: string): CatalogTab | null {
  const target = path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
  return TABS_BY_SPECIFICITY.find(tab => target === tab.to || target.startsWith(`${tab.to}/`)) ?? null
}

/** Where a record or form of a catalog tab goes back to: a path of any catalog tab (a plan opened from a bundle returns to that bundle), else the tab's own list. */
export function catalogReturn(value: unknown, own: CatalogTabKey): { to: string, labelKey: string } {
  const fallback = CATALOG_TABS.find(tab => tab.key === own)!
  const to = safeReturnTo(value, fallback.to, CATALOG_TABS.map(tab => tab.to))
  return { to, labelKey: (catalogTabOf(to) ?? fallback).labelKey }
}

type CatalogPrice = PlanView['prices'][number]

/** The price fact of a record: the first cadence, with "+N more" when it has others. */
export function priceFact(prices: readonly CatalogPrice[], describe: (price: CatalogPrice) => string, labels: { none: string, more: (count: number) => string }): string {
  const [first, ...rest] = prices
  if (!first) return labels.none
  return rest.length ? `${describe(first)} · ${labels.more(rest.length)}` : describe(first)
}

const PAGE_SIZE = 200
const MAX_PAGES = 25

/** Every item of a paginated list, following the server's total. */
export async function allPages<T>(fetchPage: (page: { limit: number, offset: number }) => Promise<{ items: T[], total: number }>): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, total } = await fetchPage({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
    out.push(...items)
    if (!items.length || out.length >= total) break
  }
  return out
}

/** The bundle revisions whose selections include this application, or null when the bundles could not be loaded. */
export async function bundlesWithApp(fetchPage: (page: { limit: number, offset: number }) => Promise<{ items: BundleView[], total: number }>, appId: string): Promise<BundleView[] | null> {
  try {
    const bundles = await allPages(fetchPage)
    return bundles.filter(bundle => bundle.selections.some(selection => selection.app_id === appId))
  } catch {
    return null
  }
}

/** The plan versions that include or offer any of these bundle revisions, or null when the plans could not be loaded. */
export async function plansUsingBundles(fetchPage: (page: { limit: number, offset: number }) => Promise<{ items: PlanView[], total: number }>, bundleRevisionIds: readonly string[]): Promise<PlanView[] | null> {
  try {
    const plans = await allPages(fetchPage)
    const wanted = new Set(bundleRevisionIds)
    return plans.filter(plan => [...plan.included_bundle_revision_ids, ...plan.optional_bundle_revision_ids].some(id => wanted.has(id)))
  } catch {
    return null
  }
}

/** The plan versions that include or offer this bundle version; null when the plans could not be loaded. */
export async function plansUsingBundle(fetchPage: (page: { limit: number, offset: number }) => Promise<{ items: PlanView[], total: number }>, bundleRevisionId: string): Promise<PlanView[] | null> {
  return plansUsingBundles(fetchPage, [bundleRevisionId])
}
