// Relative import: this module is unit-tested directly under plain vitest.
import { isEditableKeyTarget } from '../useEscapeBack'

/*
 * The shell keyboard layer (Tasmim spec §5). Every shortcut is decided here, so all of them
 * share one key rule and one "may a plain key act now" test. Nuxt UI's defineShortcuts is not
 * used: in 4.11.1 it cannot match `/`, `?` or `[` by position, ignores IME composition and
 * open menus.
 */

/** The keydown fields the layer reads. A KeyboardEvent satisfies it; tests pass plain objects. */
export interface ShortcutKeyEvent {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat: boolean
  isComposing: boolean
  /** 229 while an IME holds the key; some browsers leave isComposing false on the first key. */
  keyCode?: number
  defaultPrevented: boolean
  target: unknown
}

const ASCII_PRINTABLE = /^[\x20-\x7e]$/
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

/**
 * The key a shortcut sees. A Latin layout's own character wins (QWERTY, AZERTY, QWERTZ and
 * Dvorak follow their labels). A non-Latin character (Arabic «ن») or a dead key falls back to
 * the US physical position, so the same key works on an Arabic keyboard: «ل» is g, «ج» is [,
 * «ظ» is /. Returns a lower-case letter, a digit, `/`, `?`, `[` or null.
 */
export function shortcutKey(event: Pick<ShortcutKeyEvent, 'key' | 'code' | 'shiftKey'>): string | null {
  const { key, code } = event
  if (/^[a-z0-9]$/i.test(key)) return key.toLowerCase()
  if (key === '/' || key === '?' || key === '[') return key
  if (key === '؟') return '?'
  if (ASCII_PRINTABLE.test(key)) return null
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]!.toLowerCase()
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]!
  if (code === 'Slash') return event.shiftKey ? '?' : '/'
  if (code === 'BracketLeft') return '['
  return null
}

function composing(event: ShortcutKeyEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

/** A row a list offers to J / K (Tasmim spec §5); its container calls useRowNavigation. */
export const ROW_SELECTOR = '[data-shortcut-row]'

/**
 * A focused widget that owns its own letter keys: a closed Select trigger (typeahead), an open
 * listbox, a tree or a grid. A list row inside a grid is exempt so J / K still move between rows.
 */
function ownsLetterKeys(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const closest = (target as { closest?: (selectors: string) => unknown }).closest
  if (typeof closest !== 'function') return false
  const find = (selectors: string) => closest.call(target, selectors)
  if (find('[role="combobox"], [role="listbox"]')) return true
  return Boolean(find('[role="tree"], [role="grid"]')) && !find(ROW_SELECTOR)
}

/** True when a plain shortcut (no ⌘, Ctrl or Alt) must leave this key alone. */
export function plainShortcutBlocked(event: ShortcutKeyEvent, context: { hydrated: boolean; overlayOpen: boolean }): boolean {
  if (!context.hydrated || context.overlayOpen) return true
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  if (event.repeat || composing(event) || event.defaultPrevented) return true
  return isEditableKeyTarget(event.target) || ownsLetterKeys(event.target)
}

/** The key that starts the go-to chord; a go key follows it, so it cannot also be a destination. */
export const CHORD_START_KEY = 'g'
/**
 * Every key the shell owns: create, the go-to chord, row navigation (j/k, bound by the task and list
 * pages), search, help and the sidebar. A /search one-key nav shortcut must not take them.
 * tools/new_app.py HARD_WIRED_SHORTCUTS is its letter/digit part (a test keeps them equal).
 */
export const SHELL_RESERVED_KEYS: readonly string[] = ['c', 'g', 'j', 'k', '/', '?', '[']

export type ShortcutAction =
  | { kind: 'palette' }
  | { kind: 'help' }
  | { kind: 'focus-search' }
  | { kind: 'create' }
  | { kind: 'chord' }
  | { kind: 'go'; key: string }
export interface ShortcutState { goSince: number | null }
/** `paletteOpen` is the one overlay ⌘K may act inside (it closes it); any other open layer blocks ⌘K. */
export interface ShortcutContext { hydrated: boolean; overlayOpen: boolean; paletteOpen: boolean; now: number }
export const IDLE_SHORTCUTS: ShortcutState = Object.freeze({ goSince: null })
/** How long `G` waits for its letter. */
export const CHORD_TIMEOUT_MS = 1000

/**
 * One step of the shell layer: the action a keydown asks for and the next chord state.
 * `[` is not here; AppSidebar owns the sidebar state and matches it with the same rule.
 */
export function matchShortcut(
  event: ShortcutKeyEvent,
  context: ShortcutContext,
  state: ShortcutState,
): { action: ShortcutAction | null; state: ShortcutState } {
  const key = shortcutKey(event)
  // ⌘K / Ctrl K on every platform, once hydrated: also in a field and in the open palette (it toggles),
  // but never on top of another open layer (DESIGN.md: no stacked overlays).
  if (key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
    const ready = context.hydrated && !event.repeat && !composing(event) && (!context.overlayOpen || context.paletteOpen)
    return { action: ready ? { kind: 'palette' } : null, state: IDLE_SHORTCUTS }
  }
  // A bare modifier (Shift on the way to `?`) keeps a pending G.
  if (MODIFIER_KEYS.has(event.key)) return { action: null, state }
  if (plainShortcutBlocked(event, context)) return { action: null, state: IDLE_SHORTCUTS }
  if (state.goSince !== null && context.now - state.goSince <= CHORD_TIMEOUT_MS) {
    const letter = key !== null && /^[a-z]$/.test(key) && !event.shiftKey
    return { action: letter ? { kind: 'go', key: key! } : null, state: IDLE_SHORTCUTS }
  }
  if (key === '?') return { action: { kind: 'help' }, state: IDLE_SHORTCUTS }
  if (key === '/') return { action: { kind: 'focus-search' }, state: IDLE_SHORTCUTS }
  if (event.shiftKey) return { action: null, state: IDLE_SHORTCUTS }
  if (key === 'c') return { action: { kind: 'create' }, state: IDLE_SHORTCUTS }
  if (key === CHORD_START_KEY) return { action: { kind: 'chord' }, state: { goSince: context.now } }
  return { action: null, state: IDLE_SHORTCUTS }
}

/** macOS and iOS show ⌘ where other platforms show Ctrl; the palette shortcut accepts both everywhere. */
export function isApplePlatform(nav: { platform?: string; userAgent?: string }): boolean {
  return /Mac|iPhone|iPad|iPod/.test(nav.platform || nav.userAgent || '')
}
