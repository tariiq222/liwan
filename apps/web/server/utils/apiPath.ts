import { createError } from 'h3'

const API_PREFIX = '/api/v1/'
const ESCAPE = /%([0-9a-fA-F]{2})/g
// RFC 3986 unreserved: decoding these never changes what a path means.
const UNRESERVED = /^[A-Za-z0-9\-._~]$/
// Characters that would let a decoded path name a different route or hide a byte from the proxy:
// slash and backslash separate segments, `%` would be decoded twice, controls are never part of a route.
const FORBIDDEN_ESCAPED = /^[/\\%\x00-\x1f\x7f]$/
const FORBIDDEN_LITERAL = /[\\\x00-\x1f\x7f]/

const invalidPath = () => createError({ statusCode: 400, data: { code: 'invalid_path', message: 'The request path is not valid.' } })

/** The one form of an `/api/v1` request path used for classification AND forwarding, so that what the proxy
 * classifies is exactly what Odoo (which decodes escapes and ignores one trailing slash) receives.
 * Decodes only unreserved escapes, strips at most one trailing slash and leaves the query string untouched.
 * Rejects (400 `invalid_path`) escaped or literal separators, `%`, controls, malformed escapes and `//`.
 * Paths outside `/api/v1/` are returned unchanged. @param target request path with optional query string */
export function canonicalApiPath(target: string): string {
  if (!target.startsWith(API_PREFIX)) return target
  const queryAt = target.indexOf('?')
  const pathname = queryAt < 0 ? target : target.slice(0, queryAt)
  const query = queryAt < 0 ? '' : target.slice(queryAt)
  if (/%(?![0-9a-fA-F]{2})/.test(pathname)) throw invalidPath()
  const decoded = pathname.replace(ESCAPE, (escape, hex: string) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16))
    if (FORBIDDEN_ESCAPED.test(char)) throw invalidPath()
    return UNRESERVED.test(char) ? char : escape
  })
  if (FORBIDDEN_LITERAL.test(decoded) || decoded.includes('//')) throw invalidPath()
  const trimmed = decoded.length > API_PREFIX.length && decoded.endsWith('/') ? decoded.slice(0, -1) : decoded
  return trimmed + query
}
