// SSR renders interactive controls (reka-ui Tabs, buttons with attached
// listeners, ...) as visible, apparently-clickable markup before the client
// has hydrated and attached their event listeners. A click that lands in
// that window is silently dropped — the DOM node exists, but nothing is
// listening yet. Gate any control that must react to its first interaction
// on this ref: `:disabled="!hydrated"` so the control only becomes live
// once Vue has taken over. (Every control gated so far is a real form
// control — Button/TabsTrigger/SelectTrigger/DropdownMenuTrigger/Input —
// so `disabled` is always the mechanism in practice; a non-form element
// that needs the same treatment would need its own solution, e.g. an
// early-return guard on the handler, not `aria-busy`, which describes a
// loading state to assistive tech rather than "not yet interactive".)
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
