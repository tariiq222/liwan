/** The single TypeScript implementation of the catalog feature-descriptor grammar.
 * Mirrors tools/webvue_cli/managed_policy.py; parity is pinned by the shared fixtures
 * deploy/catalog/fixtures/descriptor_parity.json and release_features.json.
 *
 *   boolean:<key>        -> true
 *   limit:<key>          -> null  (ceiling left to the trusted operator)
 *   limit:<key>:<int>    -> numeric ceiling 0..1e9 (schema 2 and 3)
 * Schema 3 composes every tier release-complete: the core tier, the tier's own
 * descriptors, then every other application closed (boolean false, limit 0), over
 * the release module list (every application installed in every tenant).
 * Every refusal is a CatalogInvalidError carrying the stable code `catalog_invalid`. */
export const DESCRIPTOR_GRAMMAR_V2 = 'limit:key | limit:key:<int> | boolean:key'
export const MAX_CEILING = 1_000_000_000
export const KNOWN_SCHEMA_VERSIONS = [1, 2, 3] as const
export type CatalogSchemaVersion = (typeof KNOWN_SCHEMA_VERSIONS)[number]
export type FeatureKind = 'boolean' | 'limit'
export type FeatureValue = boolean | number | null
export type ParsedFeature = { key: string; kind: FeatureKind; value: FeatureValue }

/** Keys the Odoo platform enforces for every composition, with the kind each must have.
 * Legacy (schema 1) catalogs seed them as null limits; schema 2 and 3 must declare them. */
export const REQUIRED_PLATFORM_KEYS: Readonly<Record<string, FeatureKind>> = { 'users.limit': 'limit', 'storage.limit_mb': 'limit' }
export const LEGACY_SEED_LIMITS = Object.keys(REQUIRED_PLATFORM_KEYS)

export class CatalogInvalidError extends Error {
  readonly code = 'catalog_invalid'
  constructor() { super('catalog_invalid'); this.name = 'CatalogInvalidError' }
}
const invalid = (): never => { throw new CatalogInvalidError() }

const IDENTIFIER = /^[a-z][a-z0-9_]*$/
const DESCRIPTOR = /^(boolean|limit):((?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*)(?::(0|[1-9][0-9]{0,8}|1000000000))?$/
const known = (value: number): value is CatalogSchemaVersion => (KNOWN_SCHEMA_VERSIONS as readonly number[]).includes(value)

export function parseFeatureDescriptor(raw: string, schemaVersion: number): ParsedFeature {
  if (!known(schemaVersion)) return invalid()
  const match = typeof raw === 'string' ? DESCRIPTOR.exec(raw) : null
  if (!match) return invalid()
  const kind = match[1] as FeatureKind
  const key = match[2] as string
  const ceiling = match[3]
  if (ceiling !== undefined && (kind !== 'limit' || schemaVersion === 1)) return invalid()
  if (kind === 'boolean') return { kind, key, value: true }
  return { kind, key, value: ceiling === undefined ? null : Number(ceiling) }
}

export type ParsedTier = {
  id: string
  modules?: string[]
  /** This tier's own descriptors. */
  own: ParsedFeature[]
  /** Composed descriptors: schema 2 prepends the `core` tier's set; schema 3 adds every other application closed. */
  composed: ParsedFeature[]
}
export type ParsedCatalog = { schemaVersion: CatalogSchemaVersion; baseModules?: string[]; tiers: ParsedTier[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isModuleList = (v: unknown): v is string[] => Array.isArray(v) && v.every(m => typeof m === 'string' && IDENTIFIER.test(m)) && new Set(v).size === v.length
const closed = (item: ParsedFeature): ParsedFeature => ({ ...item, value: item.kind === 'boolean' ? false : 0 })

export function parseSchemaVersion(value: unknown): CatalogSchemaVersion {
  if (typeof value !== 'number' || !Number.isInteger(value) || !known(value)) return invalid()
  return value
}

/** Validate the whole catalog structure and every tier's composed descriptors.
 * `base_modules` is required by the catalog publisher; it is validated whenever
 * present so that callers that only carry tiers (worker) share the same gate. */
export function parseCatalogTiers(solution: unknown): ParsedCatalog {
  if (!isRecord(solution)) return invalid()
  const schemaVersion = parseSchemaVersion(solution.schema_version)
  if (schemaVersion >= 2 && solution.descriptor_grammar !== DESCRIPTOR_GRAMMAR_V2) invalid()
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
    // Every tier declares its module list (possibly empty), as the Python parser requires.
    if (!isModuleList(tier.modules)) invalid()
    if (baseModules?.some(m => (tier.modules as string[]).includes(m))) invalid()
    return { id: tier.id, modules: tier.modules as string[], own: (tier.features as unknown[]).map(d => parseFeatureDescriptor(d as string, schemaVersion)) }
  })
  const core = shaped.find(t => t.id === 'core')
  if (schemaVersion >= 2 && !core) invalid()
  if (schemaVersion === 3) {
    // Every application is installed in every tenant: a module belongs to one tier only.
    const modules = [...(baseModules ?? []), ...shaped.flatMap(t => t.modules ?? [])]
    if (new Set(modules).size !== modules.length) invalid()
  }
  const tiers = shaped.map(tier => {
    const composed = schemaVersion === 1 ? tier.own
      : schemaVersion === 2 ? (tier === core ? tier.own : [...core!.own, ...tier.own])
      : [...core!.own, ...(tier === core ? [] : tier.own),
        ...shaped.filter(other => other !== core && other !== tier).flatMap(other => other.own.map(closed))]
    const kinds = new Map<string, FeatureKind>()
    for (const item of composed) {
      if (kinds.has(item.key)) invalid()
      if (Object.hasOwn(REQUIRED_PLATFORM_KEYS, item.key) && item.kind !== REQUIRED_PLATFORM_KEYS[item.key]) invalid()
      kinds.set(item.key, item.kind)
    }
    // Schema 2 and 3 derive the complete set purely from descriptors; kind-aware.
    if (schemaVersion >= 2 && !Object.entries(REQUIRED_PLATFORM_KEYS).every(([key, kind]) => kinds.get(key) === kind)) invalid()
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

/** Every module of the release: the base modules, then each tier's modules in catalog order. */
export function releaseModules(solution: unknown): string[] {
  const catalog = parseCatalogTiers(solution)
  if (!catalog.baseModules) return invalid()
  return [...new Set([...catalog.baseModules, ...catalog.tiers.flatMap(t => t.modules ?? [])])]
}

/** The create policy of one tier: schema 3 installs the whole release and closes every
 * other application; schema 1 and 2 keep base plus the tier's own modules. */
export function deriveCatalogPolicy(solution: unknown, tierId: string): { modules: string[]; features: Record<string, FeatureValue>; parsed: ParsedFeature[] } {
  const catalog = parseCatalogTiers(solution)
  const tier = catalog.tiers.find(t => t.id === tierId)
  if (!tier || !catalog.baseModules) return invalid()
  const { features, parsed } = deriveCatalogFeatures(solution, tierId)
  const modules = catalog.schemaVersion === 3 ? releaseModules(solution) : [...catalog.baseModules, ...(tier.modules ?? [])]
  return { modules, features, parsed }
}
