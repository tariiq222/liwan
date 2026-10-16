const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/

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
    const parsed = new URL(value, 'http://nasq.local')
    if (parsed.origin !== 'http://nasq.local') return fallback
    if (!allowedPrefixes.some((prefix) => belongsToPrefix(parsed.pathname, prefix))) return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export function returnToQuery(fullPath: string): { returnTo: string } {
  return { returnTo: fullPath }
}
