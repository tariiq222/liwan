/** Thin control-plane adapter: the descriptor grammar lives only in
 * @nasq/commercial-contracts (commercial/feature-descriptor.ts). */
import { deriveCatalogFeatures, deriveCatalogPolicy, type FeatureValue, type ParsedFeature } from '@nasq/commercial-contracts'

export type CatalogTierLike = { id: string; features: string[] }
export type CatalogLike = { schema_version?: number; tiers: CatalogTierLike[] }
export type { FeatureValue, ParsedFeature }

/** Throws CatalogInvalidError (`catalog_invalid`) for any malformed catalog. */
export function deriveFeatures(catalog: CatalogLike, tier: { id: string; features?: string[] }): { features: Record<string, FeatureValue>; parsed: ParsedFeature[] } {
  return deriveCatalogFeatures(catalog, tier.id)
}

/** Modules and features of one tier's create policy (schema 3: the whole release, others closed). */
export function derivePolicy(catalog: unknown, tierId: string): { modules: string[]; features: Record<string, FeatureValue>; parsed: ParsedFeature[] } {
  return deriveCatalogPolicy(catalog, tierId)
}
