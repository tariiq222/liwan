/** The file name a `Content-Disposition` header names (RFC 6266: the `filename*` form wins), or null. */
export function contentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.trim()) } catch { return null }
  }
  return /filename\s*=\s*"?([^";]+)"?/.exec(header)?.[1]?.trim() ?? null
}
