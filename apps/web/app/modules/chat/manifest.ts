import type { AppManifest } from '../types'
import { chatQuickPanel } from './quickPanel'
import { chatAppCard } from './appCard'

const manifest: AppManifest = {
  id: 'chat',
  feature: 'chat.enabled',
  routePrefixes: ['/chat'],
  quickPanel: chatQuickPanel,
  appCard: chatAppCard,
  // The application's settings are one page under Settings > Applications; what deleting a message does is its first card.
  settings: {
    id: 'chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', to: '/settings/apps/chat',
    parts: [
      { id: 'messages', labelKey: 'chatSettings.delete.title', icon: 'i-lucide-message-square-x', capability: 'chat.settings.manage' },
    ],
  },
  rail: [{ id: 'chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', to: '/chat', order: 40, core: 4 }],
  nav: [
    { to: '/chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', shortcut: 'n', goKey: 'c', capability: 'liwan.internal' },
  ],
  contextLinks: () => [
    { id: 'new-chat', labelKey: 'nav.newConversation', icon: 'i-lucide-plus', to: '/chat/new', capability: 'liwan.internal', pinned: true },
    { id: 'chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', to: '/chat', capability: 'liwan.internal' },
  ],
  commands: [
    { id: 'chat.new-conversation', labelKey: 'nav.newConversation', icon: 'i-lucide-message-circle', to: '/chat/new', capability: 'liwan.internal' },
  ],
  routeCapabilities: [{ pattern: /^\/chat(?:\/|$)/, capability: 'liwan.internal' }],
  capabilityAliases: { 'liwan.internal': 'chat.enabled' },
  returnToPaths: ['/chat'],
  isNavActive: (path, target) => (target === '/chat' && path.startsWith('/chat/new') ? false : undefined),
}
export default manifest
