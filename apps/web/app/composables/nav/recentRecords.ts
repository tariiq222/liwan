// Relative imports: this module is unit-tested directly under plain vitest.
import { railPinsOwner } from './railPins'

export const RECENT_RECORDS_MAX = 5
export const RECENT_RECORDS_COOKIE_PREFIX = 'liwan-recent-'
/** The cookie holds names too, so a long one is cut: the sidebar row truncates it anyway. */
const NAME_MAX = 40

export interface RecentRecord { id: number; name: string }
/** The records one person opened last in one company, newest first. */
export interface RecentRecordsCookie { owner: string; items: RecentRecord[] }

export const recentRecordsOwner = railPinsOwner

export function savedRecentRecords(cookie: RecentRecordsCookie | null | undefined, owner: string | null): RecentRecord[] {
  if (!owner || cookie?.owner !== owner || !Array.isArray(cookie.items)) return []
  return cookie.items.filter(item => Number.isInteger(item?.id) && item.id > 0 && typeof item.name === 'string').slice(0, RECENT_RECORDS_MAX)
}

/** The record moves to the front; an earlier entry of it goes, and only the newest `RECENT_RECORDS_MAX` stay. */
export function rememberRecentRecord(items: readonly RecentRecord[], record: RecentRecord): RecentRecord[] {
  const entry = { id: record.id, name: record.name.slice(0, NAME_MAX) }
  return [entry, ...items.filter(item => item.id !== record.id)].slice(0, RECENT_RECORDS_MAX)
}
