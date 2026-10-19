import type { MaybeRefOrGetter } from 'vue'
import { computed, inject, provide, readonly, ref, toValue, type InjectionKey, type Ref } from 'vue'
import type { AccentName } from '../types/shell'

/*
 * The application behind the current page: the shell publishes its icon, hue, name and landing page; the page
 * header draws the chip before the title and starts the trail with the application, so no page repeats them. Outside a shell nothing is published.
 */

/** `label` and `to` name the application and its landing page: the first step of the header trail. */
export interface PageAccent { icon: string; accent: AccentName; label?: string; to?: string }

const PAGE_ACCENT: InjectionKey<Readonly<Ref<PageAccent | null>>> = Symbol('webvue-page-accent')
const NO_ACCENT: Readonly<Ref<PageAccent | null>> = readonly(ref<PageAccent | null>(null))

/** The shell publishes the icon and hue of the application that owns the current route. */
export function providePageAccent(value: MaybeRefOrGetter<PageAccent | null>) {
  provide(PAGE_ACCENT, readonly(computed(() => toValue(value))))
}

/** The icon and hue of the current application, null outside a shell. */
export function usePageAccent(): Readonly<Ref<PageAccent | null>> {
  return inject(PAGE_ACCENT, NO_ACCENT)
}
