import { ChatConversationListSchema } from '@liwan/contracts'
import type { AppQuickPanel } from '../types'

/** Recent conversations in the top bar; the badge counts the conversations with something unread. */
export const chatQuickPanel: AppQuickPanel = {
  id: 'chat',
  labelKey: 'nav.chat',
  icon: 'i-lucide-message-circle',
  capability: 'liwan.internal',
  to: '/chat',
  queryKey: ['chat', 'quick-panel', 'unread'],
  count: async api => (await api('/api/v1/chat/conversations', { query: { filter: 'unread', limit: 1 }, schema: ChatConversationListSchema })).total,
  load: () => import('../../components/chat/ChatQuickPanel.vue'),
}
