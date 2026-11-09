import { ChatConversationListSchema } from '@liwan/contracts'
import type { AppCard, AppSearchApi } from '../types'

/** The `total` of the conversation list the chat sidebar draws, asked for one row. */
const total = async (api: AppSearchApi, filter: 'unread' | 'channels') =>
  (await api('/api/v1/chat/conversations', { query: { filter, limit: 1 }, schema: ChatConversationListSchema })).total

/** Conversations with unread messages, and the channels the person belongs to. */
export const chatAppCard: AppCard = {
  category: 'team',
  plan: 'included',
  surface: 'lav',
  figures: [
    { labelKey: 'launcher.figures.chat.unread', queryKey: ['chat', 'app-card', 'unread'], load: api => total(api, 'unread') },
    { labelKey: 'launcher.figures.chat.channels', queryKey: ['chat', 'app-card', 'channels'], load: api => total(api, 'channels') },
  ],
}
