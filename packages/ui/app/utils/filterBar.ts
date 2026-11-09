import type { ComputedRef, InjectionKey } from 'vue'

/** Provided by every SharedFilterBar (its fields share the toolbar row from md up): each SharedFilterField sets its label beside its control from md up. */
export const FILTER_ROW_KEY: InjectionKey<ComputedRef<boolean>> = Symbol('liwan-filter-row')
