import { safeReturnTo } from '@nasq/ui/app/utils/safeReturnTo'
import type { PlanView } from './vendorCommercial'

/** The catalog section's tabs: each keeps its own URL (links elsewhere point at them) and its own list filters. */
export const CATALOG_TABS = [
  { key: 'plans', to: '/plans', labelKey: 'vendor.plans.title' },
  { key: 'bundles', to: '/bundles', labelKey: 'vendor.bundles.title' },
  { key: 'packages', to: '/catalog', labelKey: 'vendor.packages.title' },
] as const

export type CatalogTabKey = (typeof CATALOG_TABS)[number]['key']

/** The tab whose path prefix contains `path`; null outside the catalog section. */
export function catalogTabOf(path: string): (typeof CATALOG_TABS)[number] | null {
  const target = path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
  return CATALOG_TABS.find(tab => target === tab.to || target.startsWith(`${tab.to}/`)) ?? null
}

export type CatalogTab = (typeof CATALOG_TABS)[number]

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

/** The plan versions that include or offer this bundle version; null when the plans could not be loaded. */
export async function plansUsingBundle(fetchPage: (page: { limit: number, offset: number }) => Promise<{ items: PlanView[], total: number }>, bundleRevisionId: string): Promise<PlanView[] | null> {
  try {
    const plans = await allPages(fetchPage)
    return plans.filter(plan => [...plan.included_bundle_revision_ids, ...plan.optional_bundle_revision_ids].includes(bundleRevisionId))
  } catch {
    return null
  }
}
