// Pure helpers of the settings page scroll: unit-tested directly under plain vitest.
import type { ShellContextLink } from './shellModules'

/** Share of the viewport, from the bottom, that a card must stay out of to count as the one being read. */
export const SPY_BOTTOM_MARGIN = '-55%'
/** The same band as a share of the viewport height, for the geometry check. */
export const SPY_BAND_SHARE = 0.45

let spyHash = ''
/** The hash the scroll-spy last wrote with `history.replaceState`: the router never learns it. */
export function rememberSpyHash(hash: string) { spyHash = hash }
/** Whether a router hash is the one the spy wrote, so the page already shows that card and must not scroll to it. */
export function isSpyHash(hash: string) { return hash !== '' && hash === spyHash }
/** The hash the address bar shows: after the spy rewrote it that is newer than the router's own. */
export function liveHash(routeHash: string, locationHash: string | undefined) { return locationHash ?? routeHash }

/** The part id a link scrolls to, or null for a link that opens a page. */
export function anchorOf(link: Pick<ShellContextLink, 'to'>): string | null {
  return typeof link.to === 'string' || !link.to.hash ? null : link.to.hash.replace(/^#/, '')
}

const pathOf = (link: Pick<ShellContextLink, 'to'>) => (typeof link.to === 'string' ? link.to : link.to.path ?? '')

/** Whether a link scrolls to a card of the page `path` already shows: it never changes the route. */
export function isSamePageAnchor(link: Pick<ShellContextLink, 'to'>, path: string): boolean {
  return anchorOf(link) !== null && pathOf(link) === path
}

/**
 * The card the sidebar marks as the one being read on `path`: the scroll-spy's card when this page has it, else the
 * one named by the URL hash, else the page's first card.
 */
export function effectiveActivePart(path: string, links: readonly Pick<ShellContextLink, 'to'>[], spy: string | null, hash: string): string | null {
  const here = links.filter(link => anchorOf(link) !== null && pathOf(link) === path).map(link => anchorOf(link)!)
  const wanted = [spy, hash.replace(/^#/, '')]
  return wanted.find(id => id && here.includes(id)) ?? here[0] ?? null
}

/**
 * The cards crossing the reading band, from their current geometry: below `margin` (the header) and above `bandBottom`
 * (the share of the viewport the reader is looking at); when none does, the last card passed, else the first. Computed
 * afresh each time, never accumulated from observer entries.
 */
export function cardsInBand(rects: readonly { id: string; top: number; bottom: number }[], margin: number, bandBottom: number): Set<string> {
  const inBand = rects.filter(rect => rect.bottom > margin && rect.top < bandBottom).map(rect => rect.id)
  if (inBand.length || !rects.length) return new Set(inBand)
  // Nothing crosses the band (the top of a page whose first card starts below it, or a gap between cards): the card
  // last passed is the one being read, else the first.
  const passed = rects.filter(rect => rect.bottom <= margin)
  return new Set([passed.at(-1)?.id ?? rects[0]!.id])
}

/** Whether the page is scrolled to its end: a page with nothing to scroll is not. */
export function isAtBottom(scrollY: number, innerHeight: number, scrollHeight: number): boolean {
  return scrollHeight - innerHeight > 2 && scrollY + innerHeight >= scrollHeight - 2
}

/**
 * The card being read: the topmost one in the reading band, except at the end of the page, where the last cards
 * can never reach the band (the page cannot scroll further) and the last card is the one being read.
 */
export function readingCard(order: readonly string[], visible: ReadonlySet<string>, atBottom: boolean, present: readonly string[] = order): string | null {
  return atBottom ? present.at(-1) ?? null : topmostVisible(order, visible)
}

/** The card nearest the top of the reading area among those intersecting it, in page order. */
export function topmostVisible(order: readonly string[], visible: ReadonlySet<string>): string | null {
  return order.find(id => visible.has(id)) ?? null
}

/**
 * The router scroll target for a card: its top below the header (vue-router ignores `scroll-margin`, so the margin is
 * passed as `top`). Smooth only for a click on the same page, and not at all for a reader who prefers reduced motion.
 */
export function hashScrollPosition(el: Element, scrollMarginTop: number, behavior: 'smooth' | 'instant', reducedMotion: boolean): { el: Element; top: number; behavior: ScrollBehavior } {
  return { el, top: scrollMarginTop, behavior: behavior === 'smooth' && reducedMotion ? 'auto' : behavior }
}

/** The part id in `#hash` when it is one of the page's cards. */
export function partFromHash(hash: string, ids: readonly string[]): string | null {
  let id = hash.replace(/^#/, '')
  try { id = decodeURIComponent(id) } catch { /* a malformed escape stays as typed and matches no card */ }
  return ids.includes(id) ? id : null
}

/**
 * Keeps the card a click or a direct link chose selected: the spy ignores the cards the smooth scroll passes, and the
 * card a page lands on when it cannot scroll its card to the top (the last ones). It lets go only when the reader
 * takes over the scroll (wheel, touch, keys, pointer), never on a timer, which a slow page can outrun.
 */
export function createSelectionHold() {
  let held = false
  return {
    get held() { return held },
    hold() { held = true },
    release() { held = false },
  }
}

/**
 * The element a hash names, once it exists: a settings card renders after its data arrives, so a deep link waits for it
 * (a bounded number of frames) instead of landing at the top.
 */
export async function whenElement<T>(find: () => T | null, nextFrame: () => Promise<void>, maxFrames = 90): Promise<T | null> {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const found = find()
    if (found) return found
    await nextFrame()
  }
  return find()
}

/**
 * The decisions of a settings page's scroll-spy, apart from the DOM: which card is marked, and when the spy may move
 * the mark. A card chosen by a click, a direct link or a hash navigation stays marked until the reader takes over.
 */
export function createSpy(sink: { active: () => string | null; setActive: (id: string) => void; select: (id: string) => void }) {
  const hold = createSelectionHold()
  let landed = false
  return {
    get held() { return hold.held },
    /** The page's cards are known: mark the one the URL hash names (and keep it), else the first. Once. */
    land(order: readonly string[], hash: string) {
      if (landed || !order.length) return
      landed = true
      const id = partFromHash(hash, order)
      sink.setActive(id ?? order[0]!)
      if (id) hold.hold()
    },
    /** A hash arrived by navigation (palette, back and forward): follow it and keep it. */
    navigated(order: readonly string[], hash: string) {
      const id = partFromHash(hash, order)
      if (!id) return
      sink.setActive(id)
      hold.hold()
    },
    /** A sub-list click on this page. */
    clicked(id: string) {
      hold.hold()
      sink.select(id)
    },
    /** The reader took over the scroll. */
    takeover() { hold.release() },
    /** The cards in the reading band changed, or the page reached its end. */
    reading(order: readonly string[], visible: ReadonlySet<string>, atBottom: boolean, present: readonly string[]) {
      if (hold.held) return
      const card = readingCard(order, visible, atBottom, present)
      if (card && card !== sink.active()) sink.select(card)
    },
  }
}
