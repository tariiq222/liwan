import type { PageArea } from '@nasq/ui/app/composables/usePageArea'

/** Chat, login and meeting print keep their own frame: no workspace theme (stable spacing, no entrance motion). */
const PLAIN_ROUTE = /^\/(?:chat|login)(\/|$)|^\/meetings\/[1-9]\d*\/print\/?$/
const PROJECT_RECORD = /^\/projects\/\d+(\/|$)/

/** How the layer frames a customer path; provided once by app.vue. */
export function pageArea(path: string): PageArea {
  return { plain: PLAIN_ROUTE.test(path), record: PROJECT_RECORD.test(path) }
}
