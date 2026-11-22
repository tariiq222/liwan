import { ChatConversationListSchema } from '@liwan/contracts'
import type { AppCoreCount } from '../types'

/** The badge of «المحادثات» in the core-app row and the phone tab bar: the conversations with something unread. */
export const chatCoreCount: AppCoreCount = {
  id: 'chat',
  capability: 'liwan.internal',
  to: '/chat',
  queryKey: ['chat', 'core-count', 'unread'],
  count: async api => (await api('/api/v1/chat/conversations', { query: { filter: 'unread', limit: 1 }, schema: ChatConversationListSchema })).total,
}
