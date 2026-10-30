import { computed } from 'vue'
import { isNavigationFailure, NavigationFailureType } from 'vue-router'

export type PaletteView = 'main' | 'shortcuts'
interface PaletteState { open: boolean; view: PaletteView; term: string }

/**
 * The one command palette (Tasmim spec §5), shared by the header trigger, the shell keyboard
 * layer and stories. `useState` keeps one state per request on the server and one per app on the client.
 */
export function usePalette() {
  const state = useState<PaletteState>('liwan-palette', () => ({ open: false, view: 'main', term: '' }))
  function show(view: PaletteView = 'main', term = '') {
    state.value = { open: true, view, term }
  }
  /** Closes but keeps the view and term, so the exit animation shows what the user left; `reset` clears them after it. */
  function close() {
    state.value = { ...state.value, open: false }
  }
  function reset() {
    if (!state.value.open) state.value = { open: false, view: 'main', term: '' }
  }
  function toggle() {
    if (state.value.open) close()
    else show()
  }
  const open = computed({
    get: () => state.value.open,
    set: (value: boolean) => (value ? show() : close()),
  })
  const view = computed({
    get: () => state.value.view,
    set: (value: PaletteView) => { state.value = { ...state.value, view: value, term: '' } },
  })
  const term = computed({
    get: () => state.value.term,
    set: (value: string) => { state.value = { ...state.value, term: value } },
  })
  return { open, view, term, show, close, reset, toggle }
}

/**
 * Whether reka may return focus to the trigger when the palette closes. A selection that leaves
 * the page (`leavingFor` differs from the path the palette opened on, `leavingFrom`) hands focus to
 * the layout's <main>; restoring would pull it back. Comparing with the path at close time would
 * be wrong, since the navigation has usually finished by then.
 */
export function shouldRestoreTriggerFocus(leavingFor: string | null, leavingFrom: string): boolean {
  return leavingFor === null || leavingFor === leavingFrom
}

/**
 * Whether a navigation the palette started was stopped by a guard (the unsaved-draft guard, or
 * middleware returning false). The page did not change, so nothing will focus <main>; the palette
 * returns focus to its trigger. A superseded (`cancelled`) navigation leaves focus to its successor.
 */
export function paletteNavigationBlocked(failure: unknown): boolean {
  return isNavigationFailure(failure, NavigationFailureType.aborted)
}
