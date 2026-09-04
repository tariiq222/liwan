// SSR renders interactive controls (reka-ui Tabs, buttons with attached
// listeners, ...) as visible, apparently-clickable markup before the client
// has hydrated and attached their event listeners. A click that lands in
// that window is silently dropped — the DOM node exists, but nothing is
// listening yet. Gate any control that must react to its first interaction
// on this ref: `:disabled="!hydrated"` (or `aria-busy` for non-form
// elements) so the control only becomes live once Vue has taken over.
//
// `onMounted` is the right signal here, not a global "app ready" hook: for a
// component that was server-rendered, `onMounted` fires once *that*
// component's DOM has been hydrated on the client, which is exactly the
// point past which its own listeners are attached and safe to rely on.
export function useHydrated() {
  const hydrated = ref(false)
  onMounted(() => {
    hydrated.value = true
  })
  return hydrated
}
