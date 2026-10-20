export const ENTRIES_PATH = '/finance/accounting/entries'
export const ACCOUNTS_PATH = '/finance/accounting/accounts'

export const entryRecordPath = (id: number) => `${ENTRIES_PATH}/${id}`

/** The label to show for an entry that has no number yet. */
export const entryTitle = (entry: { id: number; name: string | null }, draftLabel: string) => entry.name || `${draftLabel} #${entry.id}`
