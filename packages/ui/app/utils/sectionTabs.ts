/**
 * Section tabs share one look: square triggers and one straight 2px underline
 * under the current section. Filter toggles keep the stock `pill` UTabs.
 */

/** `UTabs variant="link"` slots for in-page sections (task, meeting). */
export const sectionTabsUi = {
  // Tabs never wrap or truncate; a narrow screen scrolls the strip instead.
  list: 'gap-1 p-0 overflow-x-auto',
  indicator: 'rounded-none h-0.5 bottom-0',
  trigger: 'grow-0 shrink-0 rounded-none px-3 py-2.5 text-sm',
  label: 'overflow-visible text-clip',
} as const

/** Route-backed tab strips (project sections, governance sub-sections). */
export const routeTabsStripClass = 'flex gap-1 overflow-x-auto border-b border-default'
export const routeTabClass = 'inline-flex items-center gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-transparent hover:border-accented hover:text-default data-[active=true]:border-primary data-[active=true]:text-primary aria-[current=page]:border-primary aria-[current=page]:text-primary'
