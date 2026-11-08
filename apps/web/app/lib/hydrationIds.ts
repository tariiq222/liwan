import { BaseTransition, KeepAlive, TransitionGroup, type App, type AppContext } from 'vue'

/*
 * Vue derives `useId()` from the chain of "serverPrefetch boundaries" above a component, and the vue-query plugin's global
 * `serverPrefetch` mixin makes every stateful component one (on both sides, so the two trees agree). Vue's built-in
 * wrappers break that agreement: the server renderer compiles `<Transition>`, `<TransitionGroup>` and `<KeepAlive>` away and
 * Nuxt's `pageTransition` wraps the page in `<Transition>` on the client only, so the browser builds one boundary more than
 * the server did and every id under it (`filter-card-v-…`, `reka-dropdown-menu-trigger-v-…`) mismatches during hydration.
 * These components take part in no id, so they are kept out of the merged options the mixin joins.
 */
const BUILT_INS = [BaseTransition, TransitionGroup, KeepAlive]

type MergedOptionsCache = AppContext & { optionsCache: WeakMap<object, object> }

/** Resolves each built-in wrapper to its own options, so no global mixin (and no `serverPrefetch` boundary) reaches it. */
export function keepBuiltInsOutOfIdTree(app: App): void {
  const { optionsCache } = app._context as MergedOptionsCache
  for (const component of BUILT_INS) optionsCache.set(component, component)
}
