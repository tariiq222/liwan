import { activeManifests } from './manifests'
import type { AppBellKind, AppSearchProvider } from './types'

/** Search providers of every application, in rail order; `/search` omits the dialog-only ones. */
export function searchProviders(surface: 'dialog' | 'page' = 'dialog'): AppSearchProvider[] {
  return activeManifests()
    .flatMap(manifest => manifest.search ?? [])
    .filter(provider => surface === 'dialog' || !provider.dialogOnly)
}

/** The application-declared handling of a bell row kind, or undefined for a kind no manifest knows. */
export function bellKindFor(kind: string): AppBellKind | undefined {
  for (const manifest of activeManifests()) {
    const found = manifest.bell?.kinds?.find(entry => entry.kind === kind)
    if (found) return found
  }
  return undefined
}

/** Route prefixes applications own, for return-to allowlists. */
export function manifestRoutePrefixes(): string[] {
  return activeManifests().flatMap(manifest => manifest.routePrefixes)
}
