import type { RouterConfig } from '@nuxt/schema'
import { hashScrollPosition, isSpyHash, whenElement } from './composables/nav/settingsScroll'
import { scrollTargetFor, whenScrollTopReachable } from './utils/scrollMemory'

function hashElement(hash: string): Element | null {
  // A hash is user-controlled and need not be a valid selector.
  try { return document.querySelector(hash) } catch { return null }
}

function hashPosition(el: Element, behavior: 'smooth' | 'instant') {
  return hashScrollPosition(el, Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0, behavior, window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

function viewport() {
  return { scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight }
}

function nextFrame() {
  return new Promise<void>(frame => { requestAnimationFrame(() => frame()) })
}

// Nuxt's own scrollBehavior restores savedPosition, which vue-router populates
// for browser back/forward alone. Every back control here pushes, so a list a
// user returns to would land at the top; app/plugins/scrollMemory.client
// records where each URL was left and this puts them back on it.
export default <RouterConfig>{
  async scrollBehavior(to, from, savedPosition) {
    // A new hash on the page already open (a settings card from the palette): scroll to it in place, smoothly.
    // A query change that keeps the hash (a filter) leaves the page where it is.
    if (to.hash && to.hash !== from.hash && !savedPosition && to.path === from.path) {
      // The spy wrote this hash itself: the page already shows that card.
      if (isSpyHash(to.hash)) return false
      const el = await whenElement(() => hashElement(to.hash), nextFrame)
      return el ? hashPosition(el, 'smooth') : false
    }
    const target = scrollTargetFor(to, from, savedPosition)
    // false keeps the current offset rather than moving the page at all.
    if (!target) return false

    // vue-router calls this only once the navigation is confirmed, and Nuxt
    // fires page:finish as soon as the incoming page's suspense resolves —
    // which for a page whose data is already cached is *before* this runs.
    // Waiting on that hook waits for an event that has been and gone, so the
    // scroll never happened at all. Wait on the document instead: it is what
    // the restore actually depends on, and it can only be measured.
    await nextFrame()
    let card = to.hash ? await whenElement(() => hashElement(to.hash), nextFrame) : null
    if (card) {
      // The card can exist before it is laid out, or be replaced while its page's data arrives, on a page still too
      // short to scroll to it. Follow the element behind the hash until it has a box and the page is tall enough, up to
      // a second; the last cards of a page never reach the top and land where they can.
      for (let frame = 0; frame < 60 && (!card.isConnected || card.getBoundingClientRect().height === 0); frame += 1) {
        await nextFrame()
        card = hashElement(to.hash) ?? card
      }
      const margin = Number.parseFloat(getComputedStyle(card).scrollMarginTop) || 0
      await whenScrollTopReachable(card.getBoundingClientRect().top + window.scrollY - margin, viewport, nextFrame, 60)
      return hashPosition(hashElement(to.hash) ?? card, 'instant')
    }
    const restingAt = window.scrollY
    await whenScrollTopReachable(target.top, viewport, nextFrame)
    // That wait spans a cold list's request. Someone who scrolled while it ran
    // has taken the page over, and moving them now would be a yank rather than
    // a restore, so leave the page where they put it.
    if (window.scrollY !== restingAt) return false
    // 'instant', not 'smooth': putting a page back where it was is not
    // motion, so there is nothing for prefers-reduced-motion to suppress
    // and nothing to run against the shell's own page entrance.
    return { ...target, behavior: 'instant' }
  },
}
