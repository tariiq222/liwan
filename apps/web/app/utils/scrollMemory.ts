interface ScrollOffset { left: number, top: number }

// A record used to open over its list, so the list kept its scroll while it was
// read. As ordinary pages the list unmounts, and vue-router hands back a
// savedPosition only for browser back/forward — never for the router.push a
// back control (or Escape) performs. These are the offsets the app remembers
// for its own pushes, keyed by the full URL because the filters that decide how
// long a list is live in the query.
const positions = new Map<string, number>()
// Oldest entry out first, so a long session cannot grow this without bound.
const REMEMBERED_LIMIT = 40

export function rememberScrollPosition(fullPath: string, top: number) {
  if (!Number.isFinite(top)) return
  // Re-insert so the map's insertion order stays least-recently-left first.
  positions.delete(fullPath)
  positions.set(fullPath, Math.max(0, Math.round(top)))
  for (const oldest of positions.keys()) {
    if (positions.size <= REMEMBERED_LIMIT) break
    positions.delete(oldest)
  }
}

export function recallScrollPosition(fullPath: string): number | undefined {
  return positions.get(fullPath)
}

export function forgetScrollPositions() {
  positions.clear()
}

export function scrollTargetFor(
  to: { path: string, fullPath: string, meta?: Record<string, unknown> },
  from: { path: string },
  savedPosition: ScrollOffset | null | undefined,
): ScrollOffset | null {
  // Browser back/forward already carries the exact offset it left.
  if (savedPosition) return savedPosition
  if (to.meta?.scrollToTop === false) return null
  // Same path, different query: a filter or a tab, not an arrival. Yanking the
  // page while someone is typing in a filter would be worse than doing nothing.
  if (to.path === from.path) return null
  return { left: 0, top: recallScrollPosition(to.fullPath) ?? 0 }
}

export function scrollTopIsReachable(top: number, viewport: { scrollHeight: number, innerHeight: number }): boolean {
  return top <= 0 || viewport.scrollHeight - viewport.innerHeight >= top
}

/**
 * The lists render from vue-query, so the document can still be one screen tall
 * when the route settles and the browser would clamp the restore to the top.
 * Waits for the page to grow past the offset, within a frame budget.
 *
 * The budget spans a cold list: the request behind it can take seconds, and a
 * restore that lands once the rows arrive is still the right one. Waiting is
 * only safe because the caller drops the restore if the reader scrolls first.
 */
export async function whenScrollTopReachable(
  top: number,
  measure: () => { scrollHeight: number, innerHeight: number },
  nextFrame: () => Promise<void>,
  maxFrames = 600,
): Promise<boolean> {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    if (scrollTopIsReachable(top, measure())) return true
    await nextFrame()
  }
  // Budget spent — a list that never arrives must not hold the scroll hostage.
  return scrollTopIsReachable(top, measure())
}
