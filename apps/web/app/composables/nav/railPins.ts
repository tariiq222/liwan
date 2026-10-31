// Relative imports: this module is unit-tested directly under plain vitest.
import type { ShellRailItem } from '@liwan/ui/app/types/shell'
import type { ShellRailModel } from './sidebarModel'

export const MAX_RAIL_PINS = 6
const DEFAULT_RAIL_PINS = 4
export const RAIL_PINS_COOKIE = 'liwan-rail-pins'

/** Pins are presentation ids of one person in one company; permissions always supply the available set. */
export interface RailPinsCookie { owner: string; ids: string[] }

export function railPinsOwner(companyId?: number, userId?: number): string | null {
  return companyId && userId ? `${companyId}:${userId}` : null
}

export function savedRailPins(cookie: RailPinsCookie | null | undefined, owner: string | null): string[] | null {
  return owner && cookie?.owner === owner && Array.isArray(cookie.ids) ? cookie.ids : null
}

/** Someone who never pinned starts with the first permitted applications; a saved empty list stays empty. */
export function resolveRailPins(available: readonly string[], saved: readonly string[] | null): string[] {
  if (saved === null) return available.slice(0, DEFAULT_RAIL_PINS)
  const permitted = new Set(available)
  return [...new Set(saved)].filter(id => permitted.has(id)).slice(0, MAX_RAIL_PINS)
}

export function toggleRailPin(pins: readonly string[], id: string): string[] {
  if (pins.includes(id)) return pins.filter(pin => pin !== id)
  return pins.length < MAX_RAIL_PINS ? [...pins, id] : [...pins]
}

/** Manifest order is kept; the open application stays visible beside the pins so the rail always shows where you are. */
export function pinnedRail(rail: ShellRailModel, pins: readonly string[], activeId: string | null): ShellRailModel {
  const shown = (item: ShellRailItem) => pins.includes(item.id) || item.id === activeId
  return { ...rail, applications: rail.applications.filter(shown) }
}
