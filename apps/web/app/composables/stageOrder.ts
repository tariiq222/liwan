export type StageMoveTarget = 'up' | 'down' | 'first' | 'last'

export function moveId<T>(ids: readonly T[], from: number, to: number): T[] {
  const next = [...ids]
  const [item] = next.splice(from, 1)
  if (item === undefined) return next
  next.splice(to, 0, item)
  return next
}

export function stageMoveIndex(length: number, from: number, target: StageMoveTarget): number {
  const last = Math.max(0, length - 1)
  if (target === 'first') return 0
  if (target === 'last') return last
  if (target === 'up') return Math.max(0, from - 1)
  return Math.min(last, from + 1)
}
