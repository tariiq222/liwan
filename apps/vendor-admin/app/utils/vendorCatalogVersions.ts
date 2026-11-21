import { commercialErrorKey, commercialFailure } from './vendorCommercial'

/** A catalog version as the control plane lists it: imported from the server, then validated, then published. */
export type CatalogVersionStatus = 'draft' | 'validated' | 'published'
export type CatalogVersionTier = { id: string, name: string, description?: string, modules?: string[], features?: string[], sellable?: boolean }
export type CatalogVersion = {
  id: string
  version: string
  status: CatalogVersionStatus
  created_at: string
  solution: { base_modules?: string[], tiers?: CatalogVersionTier[] }
}
export type CatalogVersionAction = 'validate' | 'publish'

/** The one step that moves a version forward; a published version has none. */
export function nextCatalogAction(status: CatalogVersionStatus): CatalogVersionAction | null {
  return status === 'draft' ? 'validate' : status === 'validated' ? 'publish' : null
}

/** The applications a version puts up for sale: those that say so, never the always-included core (the rule `sellableApps` applies to a release). */
export function sellableTiers(version: Pick<CatalogVersion, 'solution'>): CatalogVersionTier[] {
  return (version.solution.tiers ?? []).filter(tier => tier.id !== 'core' && tier.sellable === true)
}

/** The versions a bundle release can be created from. */
export function publishedVersions(versions: readonly CatalogVersion[]): CatalogVersion[] {
  return versions.filter(version => version.status === 'published')
}

export const catalogActionPath = (id: string, action: CatalogVersionAction) => `catalog/${encodeURIComponent(id)}/${action}`

const CATALOG_ERRORS = new Set(['conflict', 'catalog_invalid'])

/** The message key of a refused validate or publish: the two codes only these routes answer with, else the shared commercial messages (not_found, forbidden, catalog_source_not_publishable, step-up). */
export function catalogActionErrorKey(cause: unknown): string {
  const { code } = commercialFailure(cause)
  return CATALOG_ERRORS.has(code) ? `vendor.catalog.errors.${code}` : commercialErrorKey(cause)
}
