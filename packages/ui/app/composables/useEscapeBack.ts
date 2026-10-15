import { toValue, type MaybeRefOrGetter } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

// reka-ui builds every surface that owns Escape — dropdown menu, popover,
// select and combobox listbox, dialog — on one DismissableLayer primitive,
// which stamps this attribute on the layer it mounts and removes it with the
// layer. Matching the primitive rather than a list of roles is why a new kind
// of overlay cannot quietly start sharing Escape with the page underneath.
const DISMISSABLE_LAYER = '[data-dismissable-layer]'

// A keydown as this module needs to read it. Widened past KeyboardEvent so the
// predicate can be exercised without a DOM.
type EscapeCandidate = Pick<KeyboardEvent, 'key'>
  & Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>>
  & { target?: unknown, keyCode?: number }

export function isEditableKeyTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as HTMLElement & { closest?: (selectors: string) => unknown }
  const tagName = element.tagName?.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
  if (element.isContentEditable) return true
  return Boolean(element.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]'))
}

// Resolved lazily and per call: this composable runs inside SharedPageHeader,
// which every page renders on the server, where there is no document.
function keyboardHost(): Document | null {
  return typeof document === 'undefined' ? null : document
}

export function overlayOwnsEscape(root: { querySelector?: (selectors: string) => unknown } | null | undefined): boolean {
  return Boolean(root?.querySelector?.(DISMISSABLE_LAYER))
}

export function escapeLeavesRecord(event: EscapeCandidate, context: { hydrated: boolean, enabled: boolean, overlayOpen: boolean }): boolean {
  if (!context.enabled || !context.hydrated) return false
  if (event.key !== 'Escape') return false
  // keyCode 229 and isComposing are an IME still holding the key.
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || event.keyCode === 229) return false
  if (context.overlayOpen) return false
  return !isEditableKeyTarget(event.target)
}

/**
 * Escape leaves a record or form page for the same target its own back control
 * uses. `enabled` is how a page that shows no back control — a list, a section
 * root, a dashboard — keeps Escape out of the shell's hands.
 */
export function useEscapeBack(backTo: MaybeRefOrGetter<RouteLocationRaw | undefined>, enabled: MaybeRefOrGetter<boolean> = true) {
  const router = useRouter()
  const hydrated = useHydrated()

  useEventListener(keyboardHost, 'keydown', (event: KeyboardEvent) => {
    const target = toValue(backTo)
    if (!target) return
    if (!escapeLeavesRecord(event, {
      hydrated: hydrated.value,
      enabled: toValue(enabled),
      overlayOpen: overlayOwnsEscape(keyboardHost()),
    })) return
    // Navigating instead of emitting is what keeps the draft guard in charge:
    // a page's SharedUnsavedChanges answers this push in onBeforeRouteLeave.
    router.push(target)
  })
}
