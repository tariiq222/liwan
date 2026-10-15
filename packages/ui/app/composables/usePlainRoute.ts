import { inject, provide, type InjectionKey } from 'vue'

/** Tells a path whether it is a plain route: one that does not take the workspace frame. The layer knows no routes; the consuming app decides. */
export type PlainRouteMatcher = (path: string) => boolean

const PLAIN_ROUTE: InjectionKey<PlainRouteMatcher> = Symbol('plain-route')

/** Called once by the consuming app's root component. */
export function providePlainRoute(matcher: PlainRouteMatcher): void {
  provide(PLAIN_ROUTE, matcher)
}

/** The app's matcher; no route is plain until an app provides one. */
export function usePlainRoute(): PlainRouteMatcher {
  return inject(PLAIN_ROUTE, () => false)
}
