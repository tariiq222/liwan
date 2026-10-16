const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/
const MAX_RETURN_LENGTH = 512

function belongsToPrefix(pathname: string, prefix: string): boolean {
  const normalized = prefix.length > 1 ? prefix.replace(/\/$/, '') : prefix
  return pathname === normalized || pathname.startsWith(`${normalized}/`)
}

export function safeReturnTo(
  value: unknown,
  fallback: string,
  allowedPrefixes: readonly string[],
): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback
  if (CONTROL_OR_BACKSLASH.test(value)) return fallback

  try {
    const parsed = new URL(value, 'http://webvue.local')
    if (parsed.origin !== 'http://webvue.local') return fallback
    if (!allowedPrefixes.some((prefix) => belongsToPrefix(parsed.pathname, prefix))) return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

/** The path as the router matches it: case-insensitive, without a trailing slash. */
export function normalizePath(path: string): string {
  return path.toLowerCase().replace(/\/+$/, '') || '/'
}

/**
 * A same-app path from an untrusted value (a query parameter, the first entry when repeated), or null
 * when it is anything else or one of the `blocked` pages (a sign-in must not return to itself).
 */
export function safeSameAppPath(value: unknown, blocked: readonly string[]): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || raw.length > MAX_RETURN_LENGTH) return null
  // One leading slash only: `//host` and `/\host` are read as another origin by the browser.
  if (!/^\/(?![/\\])/.test(raw) || CONTROL_OR_BACKSLASH.test(raw)) return null
  if (blocked.includes(normalizePath(raw.split(/[?#]/, 1)[0] ?? ''))) return null
  return raw
}

export function returnToQuery(fullPath: string): { returnTo: string } {
  return { returnTo: fullPath }
}
