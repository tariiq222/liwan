import { computed, ref, type Ref } from 'vue'

export type ContextSidebarCookie = 'open' | 'closed'
/** Read during SSR, so the server renders the collapsed width and the first paint never jumps. */
export const CONTEXT_SIDEBAR_COOKIE = 'webvue-context-sidebar'

/** Automatic geometry follows the viewport; only an explicit toggle persists a preference. */
export function contextSidebarState(cookie: Ref<ContextSidebarCookie | null | undefined>, hydrated: Readonly<Ref<boolean>>, wide: Readonly<Ref<boolean>> = ref(true)) {
  const preference = computed(() => cookie.value === 'open' || cookie.value === 'closed' ? cookie.value : 'auto')
  const expanded = computed(() => preference.value === 'auto' ? wide.value : preference.value === 'open')
  function toggle() {
    if (!hydrated.value) return
    cookie.value = expanded.value ? 'closed' : 'open'
  }
  return { expanded, hydrated, toggle, preference }
}
