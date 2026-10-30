import { computed, ref, type Ref } from 'vue'

export type ContextSidebarCookie = 'open' | 'closed'
/** Read during SSR, so the server renders the collapsed width and the first paint never jumps. */
export const CONTEXT_SIDEBAR_COOKIE = 'liwan-context-sidebar'

/**
 * Automatic geometry follows the viewport; only an explicit toggle persists a preference. `forced` (a layer that needs
 * the room, such as a docked sheet) collapses the sidebar without touching the preference: a toggle is then ignored,
 * and the sidebar returns to the user's own state when it clears.
 */
export function contextSidebarState(
  cookie: Ref<ContextSidebarCookie | null | undefined>,
  hydrated: Readonly<Ref<boolean>>,
  wide: Readonly<Ref<boolean>> = ref(true),
  forced: Readonly<Ref<boolean>> = ref(false),
) {
  const preference = computed(() => cookie.value === 'open' || cookie.value === 'closed' ? cookie.value : 'auto')
  const own = computed(() => preference.value === 'auto' ? wide.value : preference.value === 'open')
  const expanded = computed(() => !forced.value && own.value)
  function toggle() {
    if (!hydrated.value || forced.value) return
    cookie.value = own.value ? 'closed' : 'open'
  }
  return { expanded, hydrated, forced, toggle, preference }
}
