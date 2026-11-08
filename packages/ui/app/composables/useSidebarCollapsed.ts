import { useMediaQuery } from '@vueuse/core'

/** The widths where the sidebar is the icon-only strip (shell.css: 84px between 768px and 1099px). */
export const SIDEBAR_COLLAPSED_QUERY = '(min-width: 768px) and (max-width: 1099px)'

/** True while the sidebar shows icons only. False on the server and until the client knows, so no tooltip is drawn early. */
export function useSidebarCollapsed() {
  return useMediaQuery(SIDEBAR_COLLAPSED_QUERY)
}
