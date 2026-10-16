import { useEventListener } from '@vueuse/core'
import { IDLE_SHORTCUTS, matchShortcut, type ShortcutAction, type ShortcutState } from '@webvue/ui/app/composables/shortcuts/keymap'
import { overlayOwnsEscape } from '@webvue/ui/app/composables/useEscapeBack'
import { usePalette } from './usePalette'

/** A handler runs one action and returns true when it used the key; the listener then prevents its default. */
export type ShortcutHandlers = { [K in ShortcutAction['kind']]?: (action: Extract<ShortcutAction, { kind: K }>) => boolean }

/**
 * The shell's one keyboard listener (Tasmim spec §5); call it once, from ShellHeader. It listens
 * on window in the capture phase, so a key it uses is default-prevented before any page listener
 * runs (those skip defaultPrevented keys) and never types into a field the action just focused.
 */
export function useShellShortcuts(handlers: ShortcutHandlers = {}) {
  const hydrated = useHydrated()
  const palette = usePalette()
  const builtIn: ShortcutHandlers = {
    palette: () => { palette.toggle(); return true },
    help: () => { palette.show('shortcuts'); return true },
    chord: () => true,
  }
  let state: ShortcutState = IDLE_SHORTCUTS
  useEventListener(() => (typeof window === 'undefined' ? null : window), 'keydown', (event: KeyboardEvent) => {
    const overlayOpen = overlayOwnsEscape(document)
    const result = matchShortcut(event, { hydrated: hydrated.value, overlayOpen, paletteOpen: palette.open.value, now: event.timeStamp }, state)
    state = result.state
    const action = result.action
    if (!action) return
    const run = (handlers[action.kind] ?? builtIn[action.kind]) as ((action: ShortcutAction) => boolean) | undefined
    if (run?.(action)) event.preventDefault()
  }, { capture: true })
}
