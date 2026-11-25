import { parseFeatureDescriptor } from '@liwan/commercial-contracts'
import type { CatalogVersion, CatalogVersionTier } from './vendorCatalogVersions'

/**
 * One feature of a catalog application as the versions can compare it: the parsed descriptor when it follows the
 * grammar (`boolean:key`, `limit:key[:n]`), the raw string compared opaquely otherwise. The shared parser refuses
 * malformed catalogs by throwing, so a display diff reads it leniently: anything it rejects stays opaque. Never throws.
 */
export type CatalogFeatureRef = { raw: string } & (
  | { kind: 'boolean', key: string }
  | { kind: 'limit', key: string, ceiling?: number }
  | { kind: 'opaque' }
)

export type CatalogLimitChange = { key: string, from: number | undefined, to: number | undefined }

export type CatalogAppDiff = {
  appId: string
  /** True when the application is new to this version; its features and modules read as all-added then. */
  added: boolean
  featuresAdded: CatalogFeatureRef[]
  featuresRemoved: CatalogFeatureRef[]
  limitChanges: CatalogLimitChange[]
  /** The `sellable` flag before and after; equal (including both undefined) means no flip. */
  sellableFrom: boolean | undefined
  sellableTo: boolean | undefined
  modulesAdded: string[]
  modulesRemoved: string[]
}

export type CatalogDiff = {
  appsAdded: string[]
  appsRemoved: string[]
  baseModulesAdded: string[]
  baseModulesRemoved: string[]
  /** Only the applications that changed, were added or were removed. */
  apps: CatalogAppDiff[]
}

export type CatalogDiffSummaryKey = 'appsAdded' | 'appsRemoved' | 'featuresAdded' | 'featuresRemoved' | 'limitsChanged' | 'sellableChanged' | 'modulesChanged'
export type CatalogDiffSummary = { key: CatalogDiffSummaryKey, count: number }

export function parseFeature(raw: unknown): CatalogFeatureRef {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
  try {
    const parsed = parseFeatureDescriptor(text, 2)
    if (parsed.kind === 'boolean') return { raw: text, kind: 'boolean', key: parsed.key }
    return { raw: text, kind: 'limit', key: parsed.key, ...(typeof parsed.value === 'number' ? { ceiling: parsed.value } : {}) }
  } catch {
    return { raw: text, kind: 'opaque' }
  }
}

const tierFeatures = (tier: CatalogVersionTier): CatalogFeatureRef[] =>
  (Array.isArray(tier.features) ? tier.features : []).map(parseFeature)

/** The key two features are compared by: the parsed key, or the raw string when either side does not parse. */
const featureKey = (feature: CatalogFeatureRef): string => (feature.kind === 'opaque' ? `raw:${feature.raw}` : feature.key)

/** A tier's limit values, from its `limits` record and its `limit:` descriptors; a descriptor without a number keeps the recorded value, else the limit is declared with no ceiling. */
function tierLimits(tier: CatalogVersionTier): Map<string, number | undefined> {
  const limits = new Map<string, number | undefined>()
  for (const [key, value] of Object.entries(tier.limits ?? {})) if (typeof value === 'number') limits.set(key, value)
  for (const feature of tierFeatures(tier)) {
    if (feature.kind !== 'limit') continue
    limits.set(feature.key, typeof feature.ceiling === 'number' ? feature.ceiling : limits.get(feature.key))
  }
  return limits
}

const tierModules = (tier: CatalogVersionTier): string[] => (Array.isArray(tier.modules) ? tier.modules : [])
const tierList = (version: CatalogVersion | undefined): CatalogVersionTier[] =>
  version && Array.isArray(version.solution.tiers) ? version.solution.tiers : []
const baseModules = (version: CatalogVersion | undefined): string[] =>
  version && Array.isArray(version.solution.base_modules) ? version.solution.base_modules : []

/** The change between one application's two versions, or null when nothing about it changed. */
function appDiff(current: CatalogVersionTier, previous: CatalogVersionTier): CatalogAppDiff | null {
  const currentFeatures = tierFeatures(current)
  const previousFeatures = tierFeatures(previous)
  const featuresAdded = currentFeatures.filter(feature => !previousFeatures.some(other => featureKey(other) === featureKey(feature)))
  const featuresRemoved = previousFeatures.filter(feature => !currentFeatures.some(other => featureKey(other) === featureKey(feature)))
  const currentLimits = tierLimits(current)
  const previousLimits = tierLimits(previous)
  const limitChanges = [...new Set([...currentLimits.keys(), ...previousLimits.keys()])]
    .map(key => ({ key, from: previousLimits.get(key), to: currentLimits.get(key) }))
    .filter(change => change.from !== change.to)
  const currentModules = tierModules(current)
  const previousModules = tierModules(previous)
  const modulesAdded = currentModules.filter(module => !previousModules.includes(module))
  const modulesRemoved = previousModules.filter(module => !currentModules.includes(module))
  const sellableFrom = previous.sellable
  const sellableTo = current.sellable
  return featuresAdded.length || featuresRemoved.length || limitChanges.length || sellableFrom !== sellableTo || modulesAdded.length || modulesRemoved.length
    ? { appId: current.id, added: false, featuresAdded, featuresRemoved, limitChanges, sellableFrom, sellableTo, modulesAdded, modulesRemoved }
    : null
}

/** The change a version introduces over the import before it (the next older entry of the newest-first list). */
export function catalogDiff(version: CatalogVersion | undefined, previous: CatalogVersion | undefined): CatalogDiff {
  const current = new Map(tierList(version).map(tier => [tier.id, tier]))
  const older = new Map(tierList(previous).map(tier => [tier.id, tier]))
  const diff: CatalogDiff = {
    appsAdded: [...current.keys()].filter(id => !older.has(id)),
    appsRemoved: [...older.keys()].filter(id => !current.has(id)),
    baseModulesAdded: baseModules(version).filter(module => !baseModules(previous).includes(module)),
    baseModulesRemoved: baseModules(previous).filter(module => !baseModules(version).includes(module)),
    apps: [],
  }
  for (const [id, tier] of current) {
    const before = older.get(id)
    if (!before) {
      const features = tierFeatures(tier)
      diff.apps.push({ appId: id, added: true, featuresAdded: features, featuresRemoved: [], limitChanges: [], sellableFrom: tier.sellable, sellableTo: tier.sellable, modulesAdded: tierModules(tier), modulesRemoved: [] })
    } else {
      const change = appDiff(tier, before)
      if (change) diff.apps.push(change)
    }
  }
  return diff
}

/** The changed families of a diff, with their counts; only non-zero ones, in a stable order for the chips. */
export function catalogDiffSummary(diff: CatalogDiff): CatalogDiffSummary[] {
  const sum = (pick: (app: CatalogAppDiff) => number): number => diff.apps.reduce((total, app) => total + pick(app), 0)
  const summary: CatalogDiffSummary[] = [
    { key: 'appsAdded', count: diff.appsAdded.length },
    { key: 'appsRemoved', count: diff.appsRemoved.length },
    { key: 'featuresAdded', count: sum(app => app.featuresAdded.length) },
    { key: 'featuresRemoved', count: sum(app => app.featuresRemoved.length) },
    { key: 'limitsChanged', count: sum(app => app.limitChanges.length) },
    { key: 'sellableChanged', count: sum(app => (app.sellableFrom !== app.sellableTo ? 1 : 0)) },
    { key: 'modulesChanged', count: diff.baseModulesAdded.length + diff.baseModulesRemoved.length + sum(app => app.modulesAdded.length + app.modulesRemoved.length) },
  ]
  return summary.filter(chip => chip.count > 0)
}
