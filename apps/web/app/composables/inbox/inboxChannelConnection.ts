import type { InboxChannelConnection } from '@liwan/contracts'

/** The accounts a new channel may pick: only a connected one runs a channel. */
export const selectableAccounts = (accounts: readonly InboxChannelConnection[]) => accounts.filter(account => account.state === 'connected')

/** What a picker shows for one account: its name, or the provider's id when it has none. */
export const connectionOptionLabel = (connection: Pick<InboxChannelConnection, 'label' | 'external_id'>) => connection.label || connection.external_id

/** The page of one account on the integrations settings. */
export const connectionPagePath = (id: number) => `/settings/integrations/connections/${id}`
