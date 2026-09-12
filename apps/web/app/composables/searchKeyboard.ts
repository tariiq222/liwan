import { isEditableKeyTarget } from './useEscapeBack'

type Shortcut = { shortcut: string; to: string }
type KeyboardLikeEvent = Pick<KeyboardEvent, 'key'> & { target?: unknown } & Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>> & { keyCode?: number }

export function findSearchShortcut(event: KeyboardLikeEvent, query: string, shortcuts: Shortcut[]): Shortcut | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.keyCode === 229) return undefined
  if (query || isEditableKeyTarget(event.target)) return undefined
  return shortcuts.find((item) => item.shortcut === event.key)
}
