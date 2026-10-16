const TOKEN = /^[A-Za-z0-9_-]{43}$/

/**
 * Reads the enrollment token from the address fragment and removes the fragment from the address
 * and the history entry at once, so the token is never kept by the page URL, a reload or a
 * shared screenshot. Returns null when the fragment is missing or not a token.
 */
export function takeInvitationToken(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'state' | 'replaceState'>,
): string | null {
  const token = location.hash.slice(1)
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  return TOKEN.test(token) ? token : null
}
