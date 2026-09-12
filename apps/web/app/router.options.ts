import type { RouterConfig } from '@nuxt/schema'
import { scrollTargetFor, whenScrollTopReachable } from './utils/scrollMemory'

function hashElement(hash: string): unknown {
  // A hash is user-controlled and need not be a valid selector.
  try { return document.querySelector(hash) } catch { return null }
}

// Nuxt's own scrollBehavior restores savedPosition, which vue-router populates
// for browser back/forward alone. Every back control here pushes, so a list a
// user returns to would land at the top; app/plugins/scrollMemory.client
// records where each URL was left and this puts them back on it.
export default <RouterConfig>{
  scrollBehavior(to, from, savedPosition) {
    const nuxtApp = useNuxtApp()
    const target = scrollTargetFor(to, from, savedPosition)
    // false keeps the current offset rather than moving the page at all.
    if (!target) return false

    return new Promise((resolve) => {
      nuxtApp.hooks.hookOnce('page:finish', async () => {
        await new Promise(done => setTimeout(done, 0))
        if (to.hash && hashElement(to.hash)) return resolve({ el: to.hash, behavior: 'instant' })
        await whenScrollTopReachable(target.top, () => ({
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
        }), () => new Promise<void>(frame => { requestAnimationFrame(() => frame()) }))
        // 'instant', not 'smooth': putting a page back where it was is not
        // motion, so there is nothing for prefers-reduced-motion to suppress
        // and nothing to run against the shell's own page entrance.
        resolve({ ...target, behavior: 'instant' })
      })
    })
  },
}
