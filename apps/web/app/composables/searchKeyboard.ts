import { shortcutKey } from '@webvue/ui/app/composables/shortcuts/keymap'
import { isEditableKeyTarget } from '@webvue/ui/app/composables/useEscapeBack'

type Shortcut = { shortcut: string; to: string }
type KeyboardLikeEvent = Pick<KeyboardEvent, 'key'> & { code?: string; target?: unknown; keyCode?: number }
  & Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'>>

/** The /search page's one-key jump for this key, matched by the shell keymap rule (works on Arabic layouts). */
export function findSearchShortcut(event: KeyboardLikeEvent, query: string, shortcuts: Shortcut[]): Shortcut | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.keyCode === 229) return undefined
  // The shell layer runs first (capture phase) and prevents the keys it used, such as the G chord.
  if (event.defaultPrevented || query || isEditableKeyTarget(event.target)) return undefined
  const key = shortcutKey({ key: event.key, code: event.code ?? '', shiftKey: false })
  return key ? shortcuts.find(item => item.shortcut === key) : undefined
}
