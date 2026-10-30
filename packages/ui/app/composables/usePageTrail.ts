import type { MaybeRefOrGetter } from 'vue'
import { computed, inject, readonly, ref, toValue, provide, type InjectionKey, type Ref } from 'vue'
import type { ShellCrumb } from '../types/shell'

/*
 * The page's trail (DESIGN.md §3): the shell publishes the ancestor path and the page header draws it
 * under the page title. It replaces the breadcrumb that used to live in the floating header, so there is
 * still one trail owner and one place a reader looks for it.
 */

const PAGE_TRAIL: InjectionKey<Readonly<Ref<readonly ShellCrumb[]>>> = Symbol('liwan-page-trail')
const NO_TRAIL: Readonly<Ref<readonly ShellCrumb[]>> = readonly(ref<ShellCrumb[]>([]))

/** The shell publishes the ancestors of the current route; the page header injects them. */
export function providePageTrail(items: MaybeRefOrGetter<ShellCrumb[]>) {
  provide(PAGE_TRAIL, readonly(computed(() => toValue(items))))
}

/** The ancestors of the current route, empty outside a shell. */
export function usePageTrail(): Readonly<Ref<readonly ShellCrumb[]>> {
  return inject(PAGE_TRAIL, NO_TRAIL)
}
