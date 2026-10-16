const MAX_LENGTH = 512
// Pages a sign-in must never return to (a redirect loop).
const AUTH_PATHS = new Set(['/login', '/enroll'])

/** The path as the router matches it: case-insensitive, without a trailing slash. */
export function normalizePath(path: string): string {
  return path.toLowerCase().replace(/\/+$/, '') || '/'
}

/** A same-app path from an untrusted `next` value (a query parameter), or null when it is anything else. */
export function safeReturnTo(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || raw.length > MAX_LENGTH) return null
  // One leading slash only: `//host` and `/\host` are read as another origin by the browser.
  if (!/^\/(?![/\\])/.test(raw) || /[\u0000-\u001f\u007f\\]/.test(raw)) return null
  if (AUTH_PATHS.has(normalizePath(raw.split(/[?#]/, 1)[0] ?? ''))) return null
  return raw
}
