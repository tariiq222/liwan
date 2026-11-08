/**
 * Section tabs share one look: square triggers and one straight 2.5px underline under the current section, in the
 * application's button colour (`--app-action`; the primary solid, ink, where the application has none). Filter toggles
 * keep the stock `pill` UTabs.
 */

/** `UTabs variant="link"` slots for in-page sections (task, meeting). */
export const sectionTabsUi = {
  // Tabs never wrap or truncate; a narrow screen scrolls the strip instead.
  list: 'gap-7 p-0 overflow-x-auto',
  indicator: 'rounded-none h-[2.5px] bottom-0 bg-[var(--app-action,var(--primary-solid))]',
  trigger: 'grow-0 shrink-0 rounded-none px-0.5 pt-2 pb-2.5 text-[15px] font-medium data-[state=active]:font-semibold data-[state=active]:text-highlighted',
  label: 'overflow-visible text-clip',
} as const

/** Route-backed tab strips, underline variant (the page header's views, record sections, access, vendor client). */
export const routeTabsStripClass = 'flex gap-7 overflow-x-auto border-b border-default [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
export const routeTabClass = 'group inline-flex items-center gap-2 whitespace-nowrap rounded-none border-b-[2.5px] border-transparent px-0.5 pt-2 pb-2.5 text-[15px] font-medium text-muted transition-colors hover:bg-transparent hover:border-default hover:text-highlighted data-[active=true]:border-[color:var(--app-action,var(--primary-solid))] data-[active=true]:font-semibold data-[active=true]:text-highlighted aria-[current=page]:border-[color:var(--app-action,var(--primary-solid))] aria-[current=page]:font-semibold aria-[current=page]:text-highlighted -mb-px'

/** The count beside a tab label: a soft chip, filled in the application colour on the current tab. */
export const routeTabCountClass = 'rounded-control bg-elevated px-[7px] text-[11px]/[19px] font-semibold text-muted group-data-[active=true]:bg-[var(--app-action,var(--primary-solid))] group-data-[active=true]:text-[color:var(--primary-solid-foreground)] group-aria-[current=page]:bg-[var(--app-action,var(--primary-solid))] group-aria-[current=page]:text-[color:var(--primary-solid-foreground)]'

/**
 * Route-backed tab strips, pill variant (the project workspace): a round pill container, 36px high (2px frame + 32px
 * pills), the current tab a primary-tinted pill. Narrow screens scroll the strip sideways.
 */
export const routeTabsPillStripClass = 'inline-flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-control bg-elevated/40 p-0.5 ring ring-default [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
export const routeTabPillClass = 'inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-inner px-3.5 text-sm font-medium text-muted transition-colors hover:bg-elevated hover:text-default focus-visible:ring-2 focus-visible:ring-primary data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:hover:bg-primary/15 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary'
