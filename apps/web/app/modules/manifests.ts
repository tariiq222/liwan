import type { AppManifest, AppSettingsPage, AppSettingsPart } from './types'

// Relative imports only: vitest runs these modules directly, without the `@/` alias.
const discovered = import.meta.glob<{ default: AppManifest }>('./*/manifest.ts', { eager: true })

const minOrder = (manifest: AppManifest) => Math.min(...manifest.rail.map(entry => entry.order), Number.MAX_SAFE_INTEGER)
const byRail = (list: readonly AppManifest[]): readonly AppManifest[] =>
  [...list].sort((a, b) => minOrder(a) - minOrder(b) || a.id.localeCompare(b.id))

/** Every application manifest under `modules/<app>/manifest.ts`, in rail order. */
export const appManifests: readonly AppManifest[] = byRail(Object.values(discovered).map(module => module.default))

let override: readonly AppManifest[] | null = null

/** Manifests in force: the discovered ones, or the list a test installed with `withManifests`. */
export function activeManifests(): readonly AppManifest[] {
  return override ?? appManifests
}

/** Test seam: run `fn` with `list` as the manifests in force (sync or async), then restore. Throws if an override is already active (no nesting, no concurrent async use). */
export function withManifests<T>(list: readonly AppManifest[], fn: () => T): T {
  if (override) throw new Error('withManifests cannot be nested or run concurrently: a manifest override is already active')
  const previous = override
  override = byRail(list)
  let restored = false
  const restore = () => { if (!restored) { restored = true; override = previous } }
  try {
    const result = fn()
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      return (result as unknown as Promise<unknown>).finally(restore) as unknown as T
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

function claims(manifest: AppManifest, path: string): boolean {
  return manifest.routePrefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

/** The manifest whose route prefixes claim `path`, or null for foundation paths. */
export function manifestForPath(path: string): AppManifest | null {
  const pathname = path.split(/[?#]/, 1)[0] ?? path
  return activeManifests().find(manifest => claims(manifest, pathname)) ?? null
}

const owns = (scope: string, pathname: string) => pathname === scope || pathname.startsWith(`${scope}/`)

/** The path prefix a part owns when it is not an anchor on its page's own path. */
export function settingsPartScope(part: AppSettingsPart): string | undefined {
  return part.within ?? part.to
}

/**
 * The application, settings page and part that own `path`, or null. A part owns the paths under its own scope
 * (`within`, else `to`); every other path under the page's `to` belongs to the page's first part. The most specific
 * scope wins, so a part's full page beats the base page.
 */
export function settingsPartForPath(path: string): { manifest: AppManifest; page: AppSettingsPage; part: AppSettingsPart } | null {
  const pathname = path.split(/[?#]/, 1)[0] ?? path
  let match: { manifest: AppManifest; page: AppSettingsPage; part: AppSettingsPart } | null = null
  let specificity = -1
  const consider = (manifest: AppManifest, page: AppSettingsPage, part: AppSettingsPart, scope: string) => {
    if (owns(scope, pathname) && scope.length > specificity) { match = { manifest, page, part }; specificity = scope.length }
  }
  for (const manifest of activeManifests()) {
    const page = manifest.settings
    if (!page) continue
    consider(manifest, page, page.parts[0]!, page.to)
    for (const part of page.parts) {
      const scope = settingsPartScope(part)
      if (scope) consider(manifest, page, part, scope)
    }
  }
  return match
}
