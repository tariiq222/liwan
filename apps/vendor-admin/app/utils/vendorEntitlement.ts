type FeatureMap = Record<string, boolean | number | null>
type Application = { id: string; selectable: boolean; sellable?: boolean; features: Array<{ key: string; kind: string }> }
type ReleaseLike<A extends Application = Application> = { applications: A[] }

/**
 * The applications a release puts up for sale. A catalog published before the `sellable` flag sold every
 * selectable tier, so it falls back to `selectable`; the core tier is always included and never for sale.
 */
export function sellableApps<A extends Application>(release: ReleaseLike<A> | null | undefined): A[] {
  if (!release) return []
  return release.applications.filter(app => app.id !== 'core' && (app.sellable ?? app.selectable))
}

/** Bundle-style selections of the release applications whose booleans the entitlement opens. */
export function entitledSelections(release: ReleaseLike | null | undefined, features: FeatureMap | null | undefined): { app_id: string; feature_keys: string[] }[] {
  return sellableApps(release).flatMap((app) => {
    const keys = app.features.filter(f => f.kind === 'boolean' && features?.[f.key] === true).map(f => f.key)
    return keys.length ? [{ app_id: app.id, feature_keys: keys }] : []
  })
}
