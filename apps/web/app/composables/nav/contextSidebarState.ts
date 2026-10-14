import { computed, type Ref } from 'vue'

export type ContextSidebarCookie = 'open' | 'closed'
/** Read during SSR, so the server renders the collapsed width and the first paint never jumps. */
export const CONTEXT_SIDEBAR_COOKIE = 'nasq-context-sidebar'

/** Expanded unless the cookie says `closed`; a toggle before hydration is ignored (useHydrated contract). */
export function contextSidebarState(cookie: Ref<ContextSidebarCookie | null | undefined>, hydrated: Readonly<Ref<boolean>>) {
  const expanded = computed(() => cookie.value !== 'closed')
  function toggle() {
    if (!hydrated.value) return
    cookie.value = expanded.value ? 'closed' : 'open'
  }
  return { expanded, hydrated, toggle }
}
