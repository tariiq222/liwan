/*
 * The attributes a page sets to opt in to shell shortcuts (Tasmim spec §5). The shell reads the
 * DOM for them, so it imports no page or application component (R3).
 */
export const SEARCH_TARGET = '[data-shortcut-search]'
export const CREATE_TARGET = '[data-shortcut-create]'
const FIELD = 'input, textarea'

function usable(element: HTMLElement): boolean {
  return element.getClientRects().length > 0
    && !(element as HTMLInputElement).disabled
    && element.getAttribute('aria-disabled') !== 'true'
}

/** `/`: focus and select the first visible, enabled list search a page marked; false when there is none. */
export function focusListSearch(root: ParentNode): boolean {
  for (const marked of Array.from(root.querySelectorAll<HTMLElement>(SEARCH_TARGET))) {
    const field = marked.matches(FIELD) ? marked : marked.querySelector<HTMLElement>(FIELD)
    if (!field || !usable(field)) continue
    field.focus()
    ;(field as HTMLInputElement).select?.()
    return true
  }
  return false
}

/** `C`: press the page's own create control when it marked one; false lets the shell use the module's create link. */
export function clickPageCreate(root: ParentNode): boolean {
  const control = Array.from(root.querySelectorAll<HTMLElement>(CREATE_TARGET)).find(usable)
  if (!control) return false
  control.click()
  return true
}

/**
 * `C` fallback: where the module's first create link goes, from the links the sidebar shows (so a
 * hidden create, such as the pinned new-project link on a project route, is never a shortcut).
 * Null when there is none or it points at the page already open, so the key is left alone.
 */
export function createShortcutTarget<T>(
  createLinks: readonly { id: string; to: unknown }[],
  resolve: (link: { id: string; to: unknown }) => T,
  currentPath: string,
): T | null {
  const link = createLinks[0]
  if (!link) return null
  const target = resolve(link)
  const path = typeof target === 'string' ? target.split(/[?#]/)[0] : (target as { path?: string } | null)?.path
  return path === currentPath ? null : target
}
