import { useEventListener, useMediaQuery } from '@vueuse/core'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { cardsInBand, createSpy, isAtBottom, partFromHash, rememberSpyHash, SPY_BAND_SHARE, SPY_BOTTOM_MARGIN } from './nav/settingsScroll'

/** The card of the open settings page that the sidebar marks active: set by the spy, a click or a hash navigation. */
export function useSettingsActivePart() {
  return useState<string | null>('settings-active-part', () => null)
}

/**
 * Keeps the sidebar sub-list and the URL hash on the card being read. `ids` are the DOM ids of the page's cards
 * (their parts). A sub-list click on this page scrolls in place (smoothly unless the reader prefers reduced motion)
 * and rewrites the hash with `history.replaceState`, which fires no route guard and no scroll restore; the router
 * keeps its own scroll for hashes that arrive by navigation (see router.options.ts).
 */
export function useSettingsScrollSpy(ids: MaybeRefOrGetter<readonly string[]>) {
  const route = useRoute()
  const active = useSettingsActivePart()
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  let observer: IntersectionObserver | undefined
  let observed: Element[] = []
  let mutations: MutationObserver | undefined
  let margin = 0

  function select(id: string) {
    active.value = id
    rememberSpyHash(`#${id}`)
    history.replaceState(history.state, '', `${location.pathname}${location.search}#${id}`)
  }
  const spy = createSpy({ active: () => active.value, setActive: id => { active.value = id }, select })

  function scrollTo(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    spy.clicked(id)
    el.scrollIntoView({ block: 'start', behavior: reduceMotion.value ? 'auto' : 'smooth' })
  }

  // The card being read follows the band the cards cross, or the last card once the page is scrolled to its end.
  function reselect() {
    const rects = observed.map(el => { const box = el.getBoundingClientRect(); return { id: el.id, top: box.top, bottom: box.bottom } })
    spy.reading(toValue(ids), cardsInBand(rects, margin, innerHeight * SPY_BAND_SHARE), isAtBottom(scrollY, innerHeight, document.documentElement.scrollHeight), observed.map(el => el.id))
  }
  const cardElements = () => toValue(ids).flatMap(id => document.getElementById(id) ?? [])

  function observe() {
    observer?.disconnect()
    const order = toValue(ids)
    observed = cardElements()
    if (!observed.length) return
    margin = Number.parseFloat(getComputedStyle(observed[0]!).scrollMarginTop) || 0
    observer = new IntersectionObserver(() => reselect(), { rootMargin: `-${margin}px 0px ${SPY_BOTTOM_MARGIN} 0px` })
    observed.forEach(el => observer!.observe(el))
  }

  // Cards can appear after the page mounts (a form renders them once its data arrives) or be replaced (a child route
  // swaps the page content and back), so the spy re-observes whenever the elements behind its ids change.
  function refresh() {
    const now = cardElements()
    if (now.length === observed.length && now.every((el, index) => el === observed[index])) return
    observe()
    land()
  }
  let frame = 0
  function scheduleRefresh() {
    if (frame) return
    frame = requestAnimationFrame(() => { frame = 0; refresh() })
  }

  // A sub-list link to a card of this very page: scroll here instead of navigating (the router would treat a hash the
  // spy already wrote as a duplicate visit and do nothing).
  if (import.meta.client) {
    // The reader taking over the scroll (wheel, touch, keys, pointer or scrollbar) ends the hold.
    useEventListener(window, ['wheel', 'touchstart', 'keydown', 'pointerdown'], () => spy.takeover(), { passive: true, capture: true })
    useEventListener(window, 'scroll', () => reselect(), { passive: true })
    useEventListener(document, 'click', (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('.webvue-sub-list a[href]')
      const id = anchor && anchor.pathname === location.pathname && anchor.hash ? partFromHash(anchor.hash, toValue(ids)) : null
      if (!id) return
      event.preventDefault()
      scrollTo(id)
    }, { capture: true })
  }

  // The page lands on the card its hash names, or its first, once its cards are known (they follow the user's
  // capabilities, which can arrive after the first render).
  const land = () => spy.land(toValue(ids), route.hash)
  onMounted(() => {
    land()
    observe()
    mutations = new MutationObserver(scheduleRefresh)
    mutations.observe(document.body, { childList: true, subtree: true })
  })
  watch(() => toValue(ids).join('|'), () => { land(); void nextTick(observe) })
  // A hash that arrives by navigation (palette, back/forward): the router scrolls, this only follows it.
  watch(() => route.hash, hash => spy.navigated(toValue(ids), hash))
  watch(() => route.path, () => nextTick(scheduleRefresh))
  onBeforeUnmount(() => {
    observer?.disconnect()
    mutations?.disconnect()
    if (frame) cancelAnimationFrame(frame)
  })
}
