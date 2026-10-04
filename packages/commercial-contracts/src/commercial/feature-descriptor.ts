/** The single TypeScript implementation of the catalog feature-descriptor grammar.
 * Mirrors tools/nasq_cli/managed_policy.py; parity is pinned by the shared fixture
 * deploy/catalog/fixtures/descriptor_parity.json (no cross-language code sharing).
 *
 *   boolean:<key>        -> true
 *   limit:<key>          -> null  (ceiling left to the trusted operator)
 *   limit:<key>:<int>    -> numeric ceiling 0..1e9 (schema 2 only)
 * Every refusal is a CatalogInvalidError carrying the stable code `catalog_invalid`. */
export const DESCRIPTOR_GRAMMAR_V2 = 'limit:key | limit:key:<int> | boolean:key'
export const MAX_CEILING = 1_000_000_000
export const KNOWN_SCHEMA_VERSIONS = [1, 2] as const
export type CatalogSchemaVersion = (typeof KNOWN_SCHEMA_VERSIONS)[number]
export type FeatureKind = 'boolean' | 'limit'
export type FeatureValue = boolean | number | null
export type ParsedFeature = { key: string; kind: FeatureKind; value: FeatureValue }

/** Keys the Odoo platform enforces for every composition, with the kind each must have.
 * Legacy (schema 1) catalogs seed them as null limits; schema 2 must declare them. */
export const REQUIRED_PLATFORM_KEYS: Readonly<Record<string, FeatureKind>> = { 'users.limit': 'limit', 'storage.limit_mb': 'limit' }
export const LEGACY_SEED_LIMITS = Object.keys(REQUIRED_PLATFORM_KEYS)

export class CatalogInvalidError extends Error {
  readonly code = 'catalog_invalid'
  constructor() { super('catalog_invalid'); this.name = 'CatalogInvalidError' }
}
const invalid = (): never => { throw new CatalogInvalidError() }

const IDENTIFIER = /^[a-z][a-z0-9_]*$/
const DESCRIPTOR = /^(boolean|limit):((?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*)(?::(0|[1-9][0-9]{0,8}|1000000000))?$/

export function parseFeatureDescriptor(raw: string, schemaVersion: number): ParsedFeature {
  if (schemaVersion !== 1 && schemaVersion !== 2) return invalid()
  const match = typeof raw === 'string' ? DESCRIPTOR.exec(raw) : null
  if (!match) return invalid()
  const kind = match[1] as FeatureKind
  const key = match[2] as string
  const ceiling = match[3]
  if (ceiling !== undefined && (kind !== 'limit' || schemaVersion !== 2)) return invalid()
  if (kind === 'boolean') return { kind, key, value: true }
  return { kind, key, value: ceiling === undefined ? null : Number(ceiling) }
}

export type ParsedTier = {
  id: string
  modules?: string[]
  /** This tier's own descriptors. */
  own: ParsedFeature[]
  /** Composed descriptors: schema 2 prepends the `core` tier's set (every tier inherits it). */
  composed: ParsedFeature[]
}
export type ParsedCatalog = { schemaVersion: CatalogSchemaVersion; baseModules?: string[]; tiers: ParsedTier[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isModuleList = (v: unknown): v is string[] => Array.isArray(v) && v.every(m => typeof m === 'string' && IDENTIFIER.test(m)) && new Set(v).size === v.length

export function parseSchemaVersion(value: unknown): CatalogSchemaVersion {
  if (typeof value !== 'number' || !Number.isInteger(value) || (value !== 1 && value !== 2)) return invalid()
  return value
}

/** Validate the whole catalog structure and every tier's composed descriptors.
 * `base_modules` is required by the catalog publisher; it is validated whenever
 * present so that callers that only carry tiers (worker) share the same gate. */
export function parseCatalogTiers(solution: unknown): ParsedCatalog {
  if (!isRecord(solution)) return invalid()
  const schemaVersion = parseSchemaVersion(solution.schema_version)
  if (schemaVersion === 2 && solution.descriptor_grammar !== DESCRIPTOR_GRAMMAR_V2) invalid()
  let baseModules: string[] | undefined
  if (solution.base_modules !== undefined) {
    if (!isModuleList(solution.base_modules) || solution.base_modules.length === 0) invalid()
    baseModules = solution.base_modules as string[]
  }
  const rawTiers = solution.tiers
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) return invalid()
  const ids = new Set<string>()
  const shaped = rawTiers.map(tier => {
    if (!isRecord(tier) || typeof tier.id !== 'string' || !IDENTIFIER.test(tier.id) || ids.has(tier.id)) return invalid()
    ids.add(tier.id)
    if (!Array.isArray(tier.features)) invalid()
    if (tier.modules !== undefined && !isModuleList(tier.modules)) invalid()
    if (tier.modules !== undefined && baseModules?.some(m => (tier.modules as string[]).includes(m))) invalid()
    return { id: tier.id, modules: tier.modules as string[] | undefined, own: (tier.features as unknown[]).map(d => parseFeatureDescriptor(d as string, schemaVersion)) }
  })
  const core = shaped.find(t => t.id === 'core')
  if (schemaVersion === 2 && !core) invalid()
  const tiers = shaped.map(tier => {
    const composed = schemaVersion === 2 && tier !== core ? [...core!.own, ...tier.own] : tier.own
    const kinds = new Map<string, FeatureKind>()
    for (const item of composed) {
      if (kinds.has(item.key)) invalid()
      if (Object.hasOwn(REQUIRED_PLATFORM_KEYS, item.key) && item.kind !== REQUIRED_PLATFORM_KEYS[item.key]) invalid()
      kinds.set(item.key, item.kind)
    }
    // Schema 2 derives the complete set purely from descriptors; kind-aware.
    if (schemaVersion === 2 && !Object.entries(REQUIRED_PLATFORM_KEYS).every(([key, kind]) => kinds.get(key) === kind)) invalid()
    return { ...tier, composed }
  })
  return { schemaVersion, baseModules, tiers }
}

/** Derive one tier's feature map from the shared parse. Schema 1 seeds both legacy limits as null. */
export function deriveCatalogFeatures(solution: unknown, tierId: string): { features: Record<string, FeatureValue>; parsed: ParsedFeature[] } {
  const catalog = parseCatalogTiers(solution)
  const tier = catalog.tiers.find(t => t.id === tierId)
  if (!tier) return invalid()
  const features: Record<string, FeatureValue> = {}
  if (catalog.schemaVersion === 1) for (const key of LEGACY_SEED_LIMITS) features[key] = null
  for (const item of tier.composed) features[item.key] = item.value
  return { features, parsed: tier.composed }
}
