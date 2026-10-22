import type { AppAttentionProvider, AppAttentionRow, AppWorkKind } from '../../modules/types'

/** A row as the surfaces show it: the provider's row plus the rail module it came from. */
export type AttentionRowWithModule = AppAttentionRow & { module: string; work: AppWorkKind }

/** How many rows one provider returns, enough for the work page; every surface cuts the merged list to its own limit. */
export const ATTENTION_ROWS_PER_PROVIDER = 20

/** How many merged rows a surface shows unless it asks for another number. */
export const DEFAULT_SURFACE_ROWS = 3

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
  const flat = results.flatMap(({ provider, rows }) => rows.map(row => ({ ...row, id: `${provider.id}:${row.id}`, module: provider.module, work: provider.work })))
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

/** Rows split by what they ask of the user, each group keeping the merged order (urgent first). */
export function groupByWork(rows: readonly AttentionRowWithModule[]): Record<AppWorkKind, AttentionRowWithModule[]> {
  return {
    execute: rows.filter(row => row.work === 'execute'),
    decide: rows.filter(row => row.work === 'decide'),
    follow: rows.filter(row => row.work === 'follow'),
  }
}

export const WORK_KINDS: readonly AppWorkKind[] = ['execute', 'decide', 'follow']

/** The work kind a `?tab=` value names; anything else (missing, repeated, unknown) is the first kind. */
export function parseWorkKind(value: unknown): AppWorkKind {
  return WORK_KINDS.find(kind => kind === value) ?? 'execute'
}

/** The rail modules present in `rows`, in the order they first appear. */
export function sourcesOf(rows: readonly AttentionRowWithModule[]): string[] {
  return [...new Set(rows.map(row => row.module))]
}

/** Rows of one source (`'all'` keeps every source) whose label, caption or suggestion contains the text, ignoring case. */
export function filterWorkRows(rows: readonly AttentionRowWithModule[], filter: { source: string; query: string }): AttentionRowWithModule[] {
  const needle = filter.query.trim().toLocaleLowerCase()
  return rows.filter(row => (filter.source === 'all' || row.module === filter.source)
    && (!needle || [row.label, row.caption, row.suggestion].some(text => text?.toLocaleLowerCase().includes(needle))))
}

/** Personal surfaces retain every provider-bounded row before grouping and counting by kind. */
export const WORK_ROWS_LIMIT = Number.POSITIVE_INFINITY

/**
 * The work kinds for which some provider returned as many rows as it is allowed to: it may have had more, so a count
 * of that kind is a lower bound.
 */
export function cappedWorkKinds(results: ReadonlyArray<{ provider: AppAttentionProvider; rows: readonly AppAttentionRow[] }>): AppWorkKind[] {
  return WORK_KINDS.filter(kind => results.some(({ provider, rows }) => provider.work === kind && rows.length >= ATTENTION_ROWS_PER_PROVIDER))
}

/** A count of loaded rows, with a "+" only when a provider hit its cap so the count is a lower bound. */
export function workCountLabel(count: number, kindCapped: boolean): string {
  return kindCapped ? `${count}+` : String(count)
}
