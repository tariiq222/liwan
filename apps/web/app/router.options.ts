import type { RouterConfig } from '@nuxt/schema'
import { scrollTargetFor, whenScrollTopReachable } from './utils/scrollMemory'

function hashElement(hash: string): unknown {
  // A hash is user-controlled and need not be a valid selector.
  try { return document.querySelector(hash) } catch { return null }
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
    if (to.hash && hashElement(to.hash)) return { el: to.hash, behavior: 'instant' }
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
