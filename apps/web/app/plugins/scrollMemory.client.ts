import { isNavigationFailure, NavigationFailureType } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import { forgetScrollPosition, rememberScrollPosition } from '../utils/scrollMemory'

// A router guard runs before the outgoing page unmounts, which is the last
// moment the document still has the leaving page's own height and offset.
// By the time scrollBehavior is called the incoming page has already rendered
// and window.scrollY has been clamped to it.
export default defineNuxtPlugin(() => {
  const router = useRouter()
  let freshDestination: string | undefined
  useEventListener(document, 'click', (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('[data-fresh-navigation] a[href]')
    // A link to a card (a hash) scrolls to it; a visit to the top would undo that.
    if (!anchor || anchor.hash || anchor.target === '_blank' || anchor.origin !== location.origin) return
    freshDestination = router.resolve(anchor.pathname + anchor.search + anchor.hash).fullPath
  }, { capture: true })
  router.afterEach((to, from, failure) => {
    const fresh = freshDestination === to.fullPath
    freshDestination = undefined
    if (!fresh || (failure && !isNavigationFailure(failure, NavigationFailureType.duplicated))) return
    forgetScrollPosition(to.fullPath)
    // Same-path filters normally keep scroll; an explicit shell visit starts at the top, including an active-link click.
    if (to.path === from.path) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  })
  router.beforeEach((to, from) => {
    if (from.path !== to.path) rememberScrollPosition(from.fullPath, window.scrollY)
  })
})
