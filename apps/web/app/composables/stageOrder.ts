export function moveId(ids: number[], from: number, to: number): number[] {
  const next = [...ids]
  const [item] = next.splice(from, 1)
  if (item === undefined) return next
  next.splice(to, 0, item)
  return next
}
