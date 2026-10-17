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

/** Route-backed tab strips, underline variant (record sections, access, vendor client). */
export const routeTabsStripClass = 'flex gap-1 overflow-x-auto border-b border-default'
export const routeTabClass = 'inline-flex items-center gap-2 whitespace-nowrap rounded-none border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-transparent hover:border-accented hover:text-default data-[active=true]:border-primary data-[active=true]:text-primary aria-[current=page]:border-primary aria-[current=page]:text-primary'

/**
 * Route-backed tab strips, pill variant (the project workspace): a round pill container, 36px high (2px frame + 32px
 * pills), the current tab a primary-tinted pill. Narrow screens scroll the strip sideways.
 */
export const routeTabsPillStripClass = 'inline-flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-elevated/40 p-0.5 ring ring-default [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
export const routeTabPillClass = 'inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-medium text-muted transition-colors hover:bg-elevated hover:text-default focus-visible:ring-2 focus-visible:ring-primary data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:hover:bg-primary/15 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary'
