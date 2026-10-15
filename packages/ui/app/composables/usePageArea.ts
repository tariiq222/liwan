import { inject, provide, type InjectionKey } from 'vue'

/** How the layout frames a path: `plain` keeps its own frame (no workspace spacing), `area` marks a section of the app, `record` a single record inside it. */
export interface PageArea { plain: boolean; area: boolean; record: boolean }
export type PageAreaClassifier = (path: string) => PageArea

const NEUTRAL: PageArea = { plain: false, area: false, record: false }
const PAGE_AREA: InjectionKey<PageAreaClassifier> = Symbol('page-area')

/** Called once by the consuming app's root component; the layer knows no routes. */
export function providePageArea(classify: PageAreaClassifier): void {
  provide(PAGE_AREA, classify)
}

/** The app's classifier; every path is a neutral workspace page until an app provides one. */
export function usePageArea(): PageAreaClassifier {
  return inject(PAGE_AREA, () => NEUTRAL)
}
