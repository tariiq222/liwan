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
