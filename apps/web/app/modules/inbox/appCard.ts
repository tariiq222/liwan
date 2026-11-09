import { InboxConversationListSchema } from '@liwan/contracts'
import type { AppCard, AppSearchApi } from '../types'

const CAPABILITY = 'inbox.conversations.read'
/** The `total` of the conversation list the inbox page itself draws, asked for one row. */
const total = async (api: AppSearchApi, query: Record<string, string | number>) =>
  (await api('/api/v1/inbox/conversations', { query: { ...query, limit: 1 }, schema: InboxConversationListSchema })).total

/** Open conversations, and the open ones nobody has taken yet. */
export const inboxAppCard: AppCard = {
  category: 'sales',
  plan: 'addon',
  surface: 'mint',
  figures: [
    { labelKey: 'launcher.figures.inbox.open', capability: CAPABILITY, queryKey: ['inbox', 'conversations', 'app-card', 'open'], load: api => total(api, { state: 'open' }) },
    { labelKey: 'launcher.figures.inbox.unassigned', capability: CAPABILITY, queryKey: ['inbox', 'conversations', 'app-card', 'unassigned'], load: api => total(api, { state: 'open', assignee: 'unassigned' }) },
  ],
}
