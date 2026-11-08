// Relative imports: this module is unit-tested directly under plain vitest.
import type { ShellRailItem } from '@liwan/ui/app/types/shell'
import type { ShellRailModel } from './sidebarModel'

export const MAX_RAIL_PINS = 6
export const RAIL_PINS_COOKIE = 'liwan-rail-pins'

/** Pins are presentation ids of one person in one company; permissions always supply the available set. */
export interface RailPinsCookie { owner: string; ids: string[] }

export function railPinsOwner(companyId?: number, userId?: number): string | null {
  return companyId && userId ? `${companyId}:${userId}` : null
}

export function savedRailPins(cookie: RailPinsCookie | null | undefined, owner: string | null): string[] | null {
  return owner && cookie?.owner === owner && Array.isArray(cookie.ids) ? cookie.ids : null
}

/** Someone who never pinned starts with every permitted application up to the maximum; a saved empty list stays empty. */
export function resolveRailPins(available: readonly string[], saved: readonly string[] | null): string[] {
  if (saved === null) return available.slice(0, MAX_RAIL_PINS)
  const permitted = new Set(available)
  return [...new Set(saved)].filter(id => permitted.has(id)).slice(0, MAX_RAIL_PINS)
}

export function toggleRailPin(pins: readonly string[], id: string): string[] {
  if (pins.includes(id)) return pins.filter(pin => pin !== id)
  return pins.length < MAX_RAIL_PINS ? [...pins, id] : [...pins]
}

/**
 * The «تطبيقاتي» list of the sidebar: the fixed entries around the applications the user pinned, in manifest order.
 * Settings is not an application; the sidebar footer carries it.
 */
export function pinnedApplications(rail: ShellRailModel, pins: readonly string[]): ShellRailItem[] {
  return [...rail.first, ...rail.applications.filter(item => pins.includes(item.id)), ...rail.last]
}
