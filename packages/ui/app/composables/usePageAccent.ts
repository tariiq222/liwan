import type { MaybeRefOrGetter } from 'vue'
import { computed, inject, provide, readonly, ref, toValue, type InjectionKey, type Ref } from 'vue'
import type { AccentName } from '../types/shell'

/*
 * The application behind the current page: the shell publishes its icon and hue and the page header
 * draws them as the chip before the title, so no page repeats them. Outside a shell nothing is published.
 */

export interface PageAccent { icon: string; accent: AccentName }

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
