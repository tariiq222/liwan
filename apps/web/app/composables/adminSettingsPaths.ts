import { parseOffset } from '../utils/routeQuery'

export const ADMIN_PAGE_SIZE = 25

type QueryRecord = Record<string, unknown>

// Unlike the shared `firstQuery`, admin query values may already be numbers
// (e.g. an offset passed straight from a computed `page`), so this keeps its
// own array-unwrap that accepts both strings and numbers.
function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return firstQueryValue(value[0])
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

export function parseAdminOffset(value: unknown, pageSize = ADMIN_PAGE_SIZE): number {
  const candidate = parseOffset(value)
  return Math.floor(candidate / pageSize) * pageSize
}

export function adminListQuery(query: QueryRecord, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of keys) {
    if (key === 'offset') continue
    const value = firstQueryValue(query[key])
    if (value) result[key] = value
  }
  const offset = parseAdminOffset(query.offset)
  if (offset > 0) result.offset = String(offset)
  return result
}

export function adminQueryWithOffset(query: QueryRecord, offset: number): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    const first = firstQueryValue(value)
    if (key !== 'offset' && first) result[key] = first
  }
  const validOffset = parseAdminOffset(offset)
  if (validOffset > 0) result.offset = String(validOffset)
  return result
}

export function adminPathWithQuery(path: string, query: QueryRecord): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    const first = firstQueryValue(value)
    if (first) params.set(key, first)
  }
  const suffix = params.toString()
  return suffix ? `${path}?${suffix}` : path
}
