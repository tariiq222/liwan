import { commercialErrorKey, commercialFailure } from './vendorCommercial'

/** A catalog version as the control plane lists it: imported from the server, then published (import validates it automatically). A database written before that rule can still hold the old `draft`. */
export type CatalogVersionStatus = 'draft' | 'validated' | 'published'
export type CatalogVersionTier = { id: string, name: string, description?: string, modules?: string[], features?: string[], limits?: Record<string, number>, sellable?: boolean }
export type CatalogVersion = {
  id: string
  version: string
  status: CatalogVersionStatus
  created_at: string
  /** Recorded by the control plane when it has them; the console shows what exists and never invents it. */
  published_at?: string | null
  imported_by?: string | null
  published_by?: string | null
  solution: { base_modules?: string[], tiers?: CatalogVersionTier[] }
}
export type CatalogVersionAction = 'publish'

/** The one step that moves a version forward; a published version has none. */
export function nextCatalogAction(status: CatalogVersionStatus): CatalogVersionAction | null {
  return status === 'validated' ? 'publish' : null
}

/** A row the console has no step for: imported before import validated the catalog itself, so it holds the old `draft` and only a new import validates it. */
export function legacyDraft(status: CatalogVersionStatus): boolean {
  return status !== 'validated' && status !== 'published'
}

/** The version whose applications are the current offer: the newest published one, else the newest import (the list is newest first). */
export function currentCatalogVersion(versions: readonly CatalogVersion[]): CatalogVersion | null {
  return versions.find(version => version.status === 'published') ?? versions[0] ?? null
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

/** The message key of a refused publish: the two codes only this route answers with, else the shared commercial messages (not_found, forbidden, catalog_source_not_publishable, step-up). */
export function catalogActionErrorKey(cause: unknown): string {
  const { code } = commercialFailure(cause)
  return CATALOG_ERRORS.has(code) ? `vendor.catalog.errors.${code}` : commercialErrorKey(cause)
}
