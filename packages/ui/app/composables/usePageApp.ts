import type { MaybeRefOrGetter } from 'vue'
import { computed, inject, provide, readonly, ref, toValue, type InjectionKey, type Ref } from 'vue'

/*
 * The application behind the current page: the shell publishes its icon, name and landing page; the page
 * header draws the chip before the title and starts the trail with the application, so no page repeats them. Outside a shell nothing is published.
 */

/** `label` and `to` name the application and its landing page: the first step of the header trail. */
export interface PageApp { icon: string; label?: string; to?: string }

const PAGE_APP: InjectionKey<Readonly<Ref<PageApp | null>>> = Symbol('liwan-page-app')
const NO_APP: Readonly<Ref<PageApp | null>> = readonly(ref<PageApp | null>(null))

/** The shell publishes the icon, name and landing page of the application that owns the current route. */
export function providePageApp(value: MaybeRefOrGetter<PageApp | null>) {
  provide(PAGE_APP, readonly(computed(() => toValue(value))))
}

/** The current application, null outside a shell. */
export function usePageApp(): Readonly<Ref<PageApp | null>> {
  return inject(PAGE_APP, NO_APP)
}
