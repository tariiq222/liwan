import type { AppAttentionProvider, AppAttentionRow } from '../../modules/types'

/** A row as the surfaces show it: the provider's row plus the rail module it came from. */
export type AttentionRowWithModule = AppAttentionRow & { module: string }

/** How many rows one provider returns, and how many a surface shows unless it asks for another number. */
export const ATTENTION_ROWS_PER_PROVIDER = 3

/** `'all'` is every module's providers; a module id keeps only that module's; no scope selects nothing. */
export type AttentionScope = string | 'all' | null

export function providersInScope(providers: readonly AppAttentionProvider[], scope: AttentionScope): AppAttentionProvider[] {
  if (scope === null) return []
  return scope === 'all' ? [...providers] : providers.filter(provider => provider.module === scope)
}

/** The providers a caller may use: their capability is granted, so a user without access never causes a request. */
export function visibleProviders(providers: readonly AppAttentionProvider[], can: (capability: string) => boolean): AppAttentionProvider[] {
  return providers.filter(provider => can(provider.capability))
}

/**
 * Urgent rows first, then provider order, then the order the provider returned; cut to `limit`. Row ids are namespaced
 * by their provider, and a later row pointing where an earlier one already does (two providers naming the same
 * record) is dropped.
 */
export function mergeAttentionRows(
  results: ReadonlyArray<{ provider: AppAttentionProvider; rows: readonly AppAttentionRow[] }>,
  limit: number,
): AttentionRowWithModule[] {
  const flat = results.flatMap(({ provider, rows }) => rows.map(row => ({ ...row, id: `${provider.id}:${row.id}`, module: provider.module })))
  const urgent = flat.filter(row => row.tone === 'urgent')
  const normal = flat.filter(row => row.tone !== 'urgent')
  const seen = new Set<string>()
  const unique = [...urgent, ...normal].filter(row => !seen.has(row.to) && !!seen.add(row.to))
  return unique.slice(0, Math.max(0, limit))
}

/** `failed` only when there is something to load and every provider failed; one failure never hides the others. */
export function allFailed(states: ReadonlyArray<{ isError: boolean }>): boolean {
  return states.length > 0 && states.every(state => state.isError)
}
