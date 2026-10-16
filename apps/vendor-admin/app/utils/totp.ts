/** The setup key of an `otpauth://` link in groups of four for typing by hand, or null when it has none. */
export function groupedTotpSecret(uri: string): string | null {
  let secret: string | null
  try { secret = new URL(uri).searchParams.get('secret') } catch { return null }
  return secret ? (secret.match(/.{1,4}/g) ?? []).join(' ') : null
}
