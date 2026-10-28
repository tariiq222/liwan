import { bellKindFor } from '../modules/surfaces'

/** The title an application's manifest words for its bell row, or undefined for a kind that declares none. */
export function declaredBellTitle(item: { kind: string }, t: (key: string, plural?: number) => string): string | undefined {
  return bellKindFor(item.kind)?.title?.(item as Record<string, unknown>, (key, count) => (count === undefined ? t(key) : t(key, count)))
}
