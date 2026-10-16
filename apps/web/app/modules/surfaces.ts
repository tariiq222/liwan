import { activeManifests } from './manifests'
import type { AppBellKind, AppCommand, AppSearchProvider, AppSidebarPanel } from './types'

/** The same application search providers for the dialog and the page, in rail order. */
export function searchProviders(): AppSearchProvider[] {
  return activeManifests()
    .flatMap(manifest => manifest.search ?? [])
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

/** The sidebar panel an application declares for a rail module, if any. */
export function sidebarPanelFor(module: string | null): AppSidebarPanel | undefined {
  if (!module) return undefined
  return activeManifests().find(manifest => manifest.sidebarPanel?.module === module)?.sidebarPanel
}

/** Palette commands of every application, in rail order. */
export function appCommands(): AppCommand[] {
  return activeManifests().flatMap(manifest => manifest.commands ?? [])
}
