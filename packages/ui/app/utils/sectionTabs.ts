/**
 * Section tabs share one look: square triggers and one straight 2.5px underline under the current section, in the
 * application's button colour (`--app-action`; the primary solid, ink, where the application has none). Filter toggles
 * keep the stock `pill` UTabs.
 */

/** `UTabs variant="link"` slots for in-page sections (task, meeting). */
export const sectionTabsUi = {
  // Tabs never wrap or truncate; a narrow screen scrolls the strip instead.
  list: 'gap-7 p-0 overflow-x-auto',
  indicator: 'rounded-none h-[2.5px] bottom-0 bg-[var(--app-accent,var(--primary-solid))]',
  trigger: 'grow-0 shrink-0 rounded-none px-0.5 pt-2 pb-2.5 text-(length:--liwan-fs-section) font-medium data-[state=active]:font-semibold data-[state=active]:text-highlighted',
  label: 'overflow-visible text-clip',
} as const

/**
 * Route-backed tab strips never wrap. The strip is one line that scrolls sideways inside its frame; `RouteTabs` fades the
 * edge that still has content behind it (`liwan-scroll-fade-x`, driven by --tabs-fade-l/-r) and brings the current tab into view.
 * The frame draws the 1px divider (a header that already ends in one passes `divider=false`), so the fade never cuts it.
 */
export const routeTabsFrameClass = 'min-w-0 max-w-full'
export const routeTabsFrameDividerClass = 'border-b border-default'

/** Underline variant (the page header's views, record sections, access, vendor client): the mock's `.tabs a.on`. */
export const routeTabsStripClass = 'liwan-scroll-fade-x flex flex-nowrap gap-7 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
export const routeTabClass = 'group inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-none border-b-[2.5px] border-transparent px-0.5 focus-visible:outline-offset-[-2px] pt-2 pb-2.5 text-(length:--liwan-fs-section) font-medium text-muted transition-colors hover:bg-transparent hover:border-default hover:text-highlighted data-[active=true]:border-[color:var(--app-action,var(--primary-solid))] data-[active=true]:font-semibold data-[active=true]:text-highlighted aria-[current=page]:border-[color:var(--app-action,var(--primary-solid))] aria-[current=page]:font-semibold aria-[current=page]:text-highlighted'

/** The count beside a tab label: a small badge, filled in the application colour on the current tab. */
export const routeTabCountClass = 'rounded-inner bg-elevated px-[7px] text-(length:--liwan-fs-tab-count)/[19px] font-semibold text-muted transition-colors group-data-[active=true]:bg-[var(--app-action,var(--primary-solid))] group-data-[active=true]:text-[color:var(--primary-solid-foreground)] group-aria-[current=page]:bg-[var(--app-action,var(--primary-solid))] group-aria-[current=page]:text-[color:var(--primary-solid-foreground)]'

/** A thin separator between two groups of tabs in one strip (record tabs, then the log tabs). */
export const routeTabSeparatorClass = 'mx-1 my-2 w-px shrink-0 self-stretch bg-accented'

/**
 * Pill variant (the sub-strips of the project workspace, the history views): a round pill container, 36px high (2px frame +
 * 32px pills), the current tab a primary-tinted pill. It scrolls and fades like the underline strip.
 */
export const routeTabsPillStripClass = 'liwan-scroll-fade-x inline-flex w-fit max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-control bg-elevated/40 p-0.5 ring ring-default [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
export const routeTabPillClass = 'inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-inner px-3.5 text-sm font-medium text-muted transition-colors hover:bg-elevated hover:text-default focus-visible:ring-2 focus-visible:ring-primary data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:hover:bg-primary/15 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary'
