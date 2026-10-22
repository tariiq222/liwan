/** Preferences contain presentation IDs only; permissions always supply the available set. */
export function personalCardOrder(available: readonly string[], saved: unknown): string[] {
  const permitted = new Set(available)
  const selected = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && permitted.has(id)) : []
  return [...new Set([...selected, ...available])]
}

export function movePersonalCard(order: readonly string[], id: string, direction: -1 | 1): string[] {
  const result = [...order]
  const index = result.indexOf(id)
  const next = index + direction
  if (index < 0 || next < 0 || next >= result.length) return result
  ;[result[index], result[next]] = [result[next]!, result[index]!]
  return result
}

export function personalOrderKey(companyId?: number, userId?: number): string | null {
  return companyId && userId ? `webvue:personal-order:${companyId}:${userId}` : null
}
