type Shortcut = { shortcut: string; to: string }
type KeyboardLikeEvent = Pick<KeyboardEvent, 'key'> & { target?: unknown } & Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>> & { keyCode?: number }

function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as HTMLElement & { closest?: (selectors: string) => unknown }
  const tagName = element.tagName?.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
  if (element.isContentEditable) return true
  return Boolean(element.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]'))
}

export function findSearchShortcut(event: KeyboardLikeEvent, query: string, shortcuts: Shortcut[]): Shortcut | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.keyCode === 229) return undefined
  if (query || isEditableTarget(event.target)) return undefined
  return shortcuts.find((item) => item.shortcut === event.key)
}
