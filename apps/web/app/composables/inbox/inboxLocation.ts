import { InboxLocationSchema, type InboxLocation } from '@webvue/contracts'

/** A location as typed: strings, so a half-typed number is not lost. */
export interface LocationDraft {
  latitude: string
  longitude: string
  name: string
  address: string
}

export const emptyLocationDraft = (): LocationDraft => ({ latitude: '', longitude: '', name: '', address: '' })

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
// Agents type Arabic-Indic digits and the Arabic decimal separator; Number() needs Latin ones.
const toNumber = (value: string) => Number(value.trim().replace(/[٠-٩]/g, digit => String(ARABIC_DIGITS.indexOf(digit))).replace(/[٫,]/g, '.'))

/** The wire location, or null while the coordinates are missing or out of range. */
export function buildLocation(draft: LocationDraft): InboxLocation | null {
  if (!draft.latitude.trim() || !draft.longitude.trim()) return null
  const parsed = InboxLocationSchema.safeParse({
    latitude: toNumber(draft.latitude),
    longitude: toNumber(draft.longitude),
    name: draft.name.trim() || null,
    address: draft.address.trim() || null,
  })
  return parsed.success ? parsed.data : null
}

export const locationDraftFrom = (latitude: number, longitude: number): LocationDraft => ({ ...emptyLocationDraft(), latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) })

/** The map page of a location; the link opens in a new tab, no map library is loaded. */
export const locationMapUrl = (location: Pick<InboxLocation, 'latitude' | 'longitude'>) =>
  `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`

export function normalizeLocationDraft(value: unknown): LocationDraft | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const text = (key: keyof LocationDraft) => (typeof source[key] === 'string' ? source[key] : '')
  const draft: LocationDraft = { latitude: text('latitude'), longitude: text('longitude'), name: text('name'), address: text('address') }
  return Object.values(draft).some(Boolean) ? draft : null
}
