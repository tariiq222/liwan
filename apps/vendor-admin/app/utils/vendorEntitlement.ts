type FeatureMap = Record<string, boolean | number | null>
type ReleaseLike = { applications: Array<{ id: string; selectable: boolean; features: Array<{ key: string; kind: string }> }> }

/** Bundle-style selections of the release applications whose booleans the entitlement opens. */
export function entitledSelections(release: ReleaseLike | null | undefined, features: FeatureMap | null | undefined): { app_id: string; feature_keys: string[] }[] {
  if (!release) return []
  return release.applications.filter(app => app.selectable).flatMap((app) => {
    const keys = app.features.filter(f => f.kind === 'boolean' && features?.[f.key] === true).map(f => f.key)
    return keys.length ? [{ app_id: app.id, feature_keys: keys }] : []
  })
}
