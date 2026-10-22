// Relative imports: the `@/` alias does not resolve for value imports under a plain `vitest run`.
import { canReach, canReachPath, requiredFeatureForPath, type AccessIdentity } from '../../utils/accessPolicy'
import { activeManifests } from '../../modules/manifests'
import type { AppIcon, AppServiceEntry } from '../../modules/types'
import { contextLinksForModule, useNav, visibleShellModules } from './shellModules'

/** The services of one application the user may use, headed by the application's rail label and icon. */
export interface ServiceGroup { id: string; labelKey: string; icon: AppIcon; entries: AppServiceEntry[] }

/** One link card of an application's start page. */
export interface StartCard { id: string; labelKey: string; icon: AppIcon; to: string }

export type AppStart =
  | { kind: 'unknown' }
  | { kind: 'forbidden' }
  | { kind: 'ready'; id: string; labelKey: string; icon: AppIcon; openTo: string; cards: StartCard[]; creates: StartCard[] }

const pathnameOf = (to: string) => to.split(/[?#]/, 1)[0] ?? to

/** An entry shows only when its capability, the application feature and the target route's own sub-feature allow it, and the identity can reach the target path under the route rules navigation uses. */
function serviceAllowed(identity: AccessIdentity, entry: AppServiceEntry): boolean {
  const path = pathnameOf(entry.to)
  return canReach(identity, entry.capability, path, requiredFeatureForPath(path)) && canReachPath(identity, path)
}

/** Self-service entries the identity may use, grouped by the application that declares them, in rail order; empty groups are dropped. */
export function serviceGroups(identity: AccessIdentity): ServiceGroup[] {
  return activeManifests().flatMap((manifest) => {
    const rail = manifest.rail[0]
    const entries = (manifest.services ?? []).filter(entry => serviceAllowed(identity, entry))
    return rail && entries.length ? [{ id: manifest.id, labelKey: rail.labelKey, icon: rail.icon, entries }] : []
  })
}

/**
 * What the start page of rail entry `id` shows, from the manifests alone: `unknown` for an id no application declares,
 * `forbidden` when the identity reaches none of the application's pages, else its reachable nav pages and pinned create
 * actions (a create whose target is already a page card is not repeated).
 */
export function appStartFor(id: string, identity: AccessIdentity): AppStart {
  const entry = activeManifests().flatMap(manifest => manifest.rail).find(rail => rail.id === id)
  if (!entry) return { kind: 'unknown' }
  const opened = visibleShellModules(identity).find(module => module.id === id)
  if (!opened) return { kind: 'forbidden' }
  const cards = useNav(identity)
    .filter(item => item.module === id)
    .map((item): StartCard => ({ id: item.to, labelKey: item.labelKey, icon: item.icon, to: item.to }))
  const taken = new Set(cards.map(card => card.to))
  const creates = contextLinksForModule(id, identity)
    .flatMap((link): StartCard[] => (link.pinned && typeof link.to === 'string' && !taken.has(link.to) ? [{ id: link.id, labelKey: link.labelKey, icon: link.icon, to: link.to }] : []))
  return { kind: 'ready', id, labelKey: entry.labelKey, icon: entry.icon, openTo: opened.to, cards, creates }
}
