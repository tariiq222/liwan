import type { AppManifest, AppSettingsEntry } from './types'

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

/** The application and settings entry whose `to` is `path` or a parent of it, or null (the entry owns its subtree). */
export function settingsEntryForPath(path: string): { manifest: AppManifest; entry: AppSettingsEntry } | null {
  const pathname = path.split(/[?#]/, 1)[0] ?? path
  for (const manifest of activeManifests()) {
    const entry = manifest.settings?.find(candidate => pathname === candidate.to || pathname.startsWith(`${candidate.to}/`))
    if (entry) return { manifest, entry }
  }
  return null
}
