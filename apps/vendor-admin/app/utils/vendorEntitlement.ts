type FeatureMap = Record<string, boolean | number | null>
type Application = { id: string; selectable: boolean; sellable?: boolean; features: Array<{ key: string; kind: string }> }
type ReleaseLike<A extends Application = Application> = { applications: A[] }

/**
 * The applications a release puts up for sale: those that say so. There is no fallback to `selectable` — a tier that
 * declares nothing sells nothing, which is the rule the entitlement compiler and the catalog checker apply too.
 */
export function sellableApps<A extends Application>(release: ReleaseLike<A> | null | undefined): A[] {
  if (!release) return []
  return release.applications.filter(app => app.id !== 'core' && app.sellable === true)
}

/** Bundle-style selections of the release applications whose booleans the entitlement opens. */
export function entitledSelections(release: ReleaseLike | null | undefined, features: FeatureMap | null | undefined): { app_id: string; feature_keys: string[] }[] {
  return sellableApps(release).flatMap((app) => {
    const keys = app.features.filter(f => f.kind === 'boolean' && features?.[f.key] === true).map(f => f.key)
    return keys.length ? [{ app_id: app.id, feature_keys: keys }] : []
  })
}
