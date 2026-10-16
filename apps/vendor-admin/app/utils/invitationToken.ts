const TOKEN = /^[A-Za-z0-9_-]{43}$/

/**
 * Reads the enrollment token from the address fragment, then has the router replace the route
 * without it: the router owns the history entry, so a bare history.replaceState would be undone
 * by its next write. Returns null when the fragment is missing or not a token.
 */
export async function takeInvitationToken(hash: string, clearHash: () => Promise<unknown>): Promise<string | null> {
  if (!hash) return null
  const token = hash.slice(1)
  await clearHash()
  return TOKEN.test(token) ? token : null
}
