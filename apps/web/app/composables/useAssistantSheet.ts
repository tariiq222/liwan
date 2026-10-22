import { computed, defineAsyncComponent, nextTick, ref, type Component } from 'vue'
// Relative imports: this module is unit-tested directly, where the `@/` alias does not resolve for values.
import { canReach } from '../utils/accessPolicy'
import { normalizedPath } from '../utils/routePath'
import { assistantSurface, routeScopeOf } from '../modules/surfaces'
import type { AppAssistantSurface } from '../modules/types'

/** The sheet's element id: the header button's `aria-controls` points at it. */
export const ASSISTANT_SHEET_ID = 'assistant-sheet'
/** Where the open state is kept for the browser session. */
export const SESSION_KEY = 'webvue-assistant-sheet'

/** `push` reserves room beside the workspace, `overlay` floats over it under a scrim, `full` covers the screen. */
export type AssistantSheetMode = 'push' | 'overlay' | 'full'

/** The layout for the viewport: wide is >= 1100px, desktop is >= 768px. */
export function assistantSheetMode(wide: boolean, desktop: boolean): AssistantSheetMode {
  if (wide) return 'push'
  return desktop ? 'overlay' : 'full'
}

/** Whether `path` is the assistant's own full page (or beneath it), where the sheet and its button step aside. */
export function isSurfacePath(path: string, surfaceTo: string): boolean {
  const target = normalizedPath(surfaceTo)
  const current = normalizedPath(path)
  return current === target || current.startsWith(`${target}/`)
}

// The foundation's own rail modules say nothing the assistant could use as a page.
const NO_CONTEXT_MODULES: readonly string[] = ['home', 'settings']

/**
 * The `?context=` value the full page reads (`page` or `page:id`): the record the current path lives inside, else the
 * rail module; null where there is nothing to say (home, settings, or a module id the page would not accept).
 */
export function assistantContext(path: string, moduleId: string | null): string | null {
  const scope = routeScopeOf(path)
  if (scope) return `${scope.kind}:${scope.id}`
  return moduleId && !NO_CONTEXT_MODULES.includes(moduleId) && /^[a-z]+$/.test(moduleId) ? moduleId : null
}

/** Escape closes the sheet unless something else (a menu, a dialog) owns the key, or the key belongs to an IME. */
export function assistantEscapeCloses(
  event: Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>> & { keyCode?: number },
  context: { shown: boolean; mode: AssistantSheetMode; insideSheet: boolean; overlayOpen: boolean },
): boolean {
  if (!context.shown || event.key !== 'Escape') return false
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.keyCode === 229) return false
  if (context.overlayOpen) return false
  // Beside the page (pushed) the key still belongs to the page unless focus is inside the sheet.
  return context.mode !== 'push' || context.insideSheet
}

/**
 * Makes everything beside the full-screen sheet inert and stops the page from scrolling behind it; the returned
 * function undoes exactly that. The sheet's own scrim is left alone.
 */
export function holdPageBehind(sheet: Element, body: HTMLElement): () => void {
  const behind = [...(sheet.parentElement?.children ?? [])]
    .filter(element => element !== sheet && !element.hasAttribute('inert') && !element.classList.contains('webvue-assistant-scrim'))
  for (const element of behind) element.setAttribute('inert', '')
  const overflow = body.style.overflow
  body.style.overflow = 'hidden'
  return () => {
    for (const element of behind) element.removeAttribute('inert')
    body.style.overflow = overflow
  }
}

// sessionStorage can be absent or throw (private windows, blocked site data): the sheet then simply forgets.
function sessionStore(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage } catch { return null }
}
function readSessionOpen(): boolean {
  try { return sessionStore()?.getItem(SESSION_KEY) === 'open' } catch { return false }
}
function writeSessionOpen(open: boolean): void {
  try { sessionStore()?.setItem(SESSION_KEY, open ? 'open' : 'closed') } catch { /* nothing to remember in */ }
}

// The element that opened the sheet gets focus back when it closes. Client only; the server never opens the sheet.
let opener: HTMLElement | null = null
let focusRequested = false
const bodyLoaded = ref(false)

function currentFocus(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

// One async wrapper per declared surface, so reopening the sheet never reloads the body.
const bodyViews = new WeakMap<AppAssistantSurface, Component>()
/** The surface's body, loaded on first use (the shell imports no application code, R3). */
export function assistantBodyView(surface: AppAssistantSurface): Component {
  let view = bodyViews.get(surface)
  if (!view) {
    view = defineAsyncComponent(() => surface.load().then((module) => { bodyLoaded.value = true; return module }))
    bodyViews.set(surface, view)
  }
  return view
}

/**
 * The assistant sheet's one state: whether it is open, whether this identity and page may show it, and the
 * open/close/toggle actions with focus return and session persistence. The panel and the header button share it.
 */
export function useAssistantSheet() {
  const route = useRoute()
  const { me } = useMe()
  const open = useState<boolean>('assistant-sheet-open', () => false)

  /** The declared surface, only when this user may use it (capability plus its application feature). */
  const surface = computed<AppAssistantSurface | undefined>(() => {
    const declared = assistantSurface()
    return declared && canReach(me.value, declared.capability, declared.to) ? declared : undefined
  })
  const onSurfacePage = computed(() => !!surface.value && isSurfacePath(route.path, surface.value.to))
  /** The header button shows everywhere except the full page, where that page is the surface. */
  const showButton = computed(() => !!surface.value && !onSurfacePage.value)
  const shown = computed(() => open.value && showButton.value)

  function openSheet(from?: HTMLElement | null) {
    if (!showButton.value) return
    opener = from ?? currentFocus()
    focusRequested = true
    open.value = true
    writeSessionOpen(true)
  }

  function close({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
    if (!open.value) return
    open.value = false
    writeSessionOpen(false)
    const target = opener
    opener = null
    if (restoreFocus && target?.isConnected) void nextTick(() => target.focus())
  }

  function toggle(from?: HTMLElement | null) {
    if (open.value) close()
    else openSheet(from)
  }

  /** Reopens a sheet left open earlier in this browser session; only on a wide screen, and never by stealing focus. */
  function restoreSession(wide: boolean) {
    if (open.value || !wide || !showButton.value || !readSessionOpen()) return
    open.value = true
  }

  /** True once after an explicit open: the panel then moves focus into itself. */
  function takeFocusRequest(): boolean {
    const requested = focusRequested
    focusRequested = false
    return requested
  }

  /** The full page link: the current record or module rides along as `?context=`. */
  function fullPageTo(moduleId: string | null) {
    const context = assistantContext(route.path, moduleId)
    return { path: surface.value?.to ?? '/', ...(context ? { query: { context } } : {}) }
  }

  return { surface, showButton, shown, onSurfacePage, bodyLoaded, openSheet, close, toggle, restoreSession, takeFocusRequest, fullPageTo }
}
