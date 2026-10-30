import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'chat',
  feature: 'chat.enabled',
  routePrefixes: ['/chat'],
  rail: [{ id: 'chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', to: '/chat', order: 40 }],
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
  sidebarPanel: { module: 'chat', width: 'wide', load: () => import('../../components/chat/ChatSidebarPanel.vue') },
  routeCapabilities: [{ pattern: /^\/chat(?:\/|$)/, capability: 'liwan.internal' }],
  capabilityAliases: { 'liwan.internal': 'chat.enabled' },
  returnToPaths: ['/chat'],
  isNavActive: (path, target) => (target === '/chat' && path.startsWith('/chat/new') ? false : undefined),
}
export default manifest
