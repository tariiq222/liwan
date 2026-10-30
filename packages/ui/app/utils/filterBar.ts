import type { ComputedRef, InjectionKey } from 'vue'

/** Provided by a SharedFilterBar whose fields share the toolbar row (`embedded`, `inline`): each SharedFilterField sets its label beside its control from md up. */
export const FILTER_ROW_KEY: InjectionKey<ComputedRef<boolean>> = Symbol('liwan-filter-row')
