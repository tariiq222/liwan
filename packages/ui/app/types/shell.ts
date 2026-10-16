/** One crumb of the header trail; the last one is the current page and carries no link. */
export interface ShellCrumb { label: string; to?: string }

/** One rail entry as the module rail and the mobile drawer render it. */
export interface ShellRailItem { id: string; labelKey: string; icon: string; to: string; external: boolean }
