// A one-shot hand-off for focus after a blocked navigation. An overlay that starts a
// navigation and closes before its result (the command palette) offers the element focus
// should return to; the unsaved-draft guard takes it when it blocks that navigation,
// because the element focused while the guard runs (the palette input) is gone by the
// time the user answers. Offers are made only from client event handlers.
let offered: (() => HTMLElement | null) | null = null

export function offerNavigationFocus(target: () => HTMLElement | null): void {
  offered = target
}

export function takeNavigationFocus(): HTMLElement | null {
  const target = offered?.() ?? null
  offered = null
  return target?.isConnected ? target : null
}

export function clearNavigationFocus(): void {
  offered = null
}
