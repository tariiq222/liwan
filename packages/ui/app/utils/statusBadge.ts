import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

/** What an application map returns for one value; the call site translates `labelKey` for SharedStatusBadge. */
export interface StatusBadgeEntry { tone: StatusTone; labelKey: string }

/** The entry for `value`, or a neutral one with no key when the map does not know it (a newer server's value). */
export function statusBadgeEntry<K extends string>(map: Readonly<Record<K, StatusBadgeEntry>>, value: string | null | undefined): StatusBadgeEntry {
  return value && Object.hasOwn(map, value) ? map[value as K] : { tone: 'neutral', labelKey: '' }
}

/** The label to show: the translation, else the raw value, else an em dash. */
export function badgeLabel(entry: StatusBadgeEntry, value: string | null | undefined, t: (key: string) => string): string {
  return entry.labelKey ? t(entry.labelKey) : value || '—'
}
