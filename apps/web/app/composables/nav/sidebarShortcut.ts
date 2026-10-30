// Plain import by package path, no Nuxt alias: this module is unit-tested directly under plain vitest.
import { plainShortcutBlocked, shortcutKey, type ShortcutKeyEvent } from '@liwan/ui/app/composables/shortcuts/keymap'

export type SidebarShortcutEvent = ShortcutKeyEvent

/**
 * `[` collapses or expands the context sidebar (Tasmim spec §5). Matched by the shared keymap
 * rule: the `[` character on a Latin layout, else the BracketLeft position («ج» on Arabic, «ü» on
 * QWERTZ, the ^ dead key on AZERTY). AppSidebar owns the sidebar state, so this key keeps its own
 * listener there instead of the shell layer's.
 */
export function isSidebarToggleShortcut(event: SidebarShortcutEvent, overlayOpen: boolean): boolean {
  if (event.shiftKey) return false
  return shortcutKey(event) === '[' && !plainShortcutBlocked(event, { hydrated: true, overlayOpen })
}
