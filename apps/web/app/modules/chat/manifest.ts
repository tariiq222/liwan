import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'chat',
  feature: 'chat.enabled',
  routePrefixes: ['/chat'],
  rail: [{ id: 'chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', to: '/chat', order: 40, accent: 'sky' }],
  nav: [
    { to: '/chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', shortcut: 'n', goKey: 'c', capability: 'webvue.internal' },
  ],
  contextLinks: () => [
    { id: 'new-chat', labelKey: 'nav.newConversation', icon: 'i-lucide-plus', to: '/chat/new', capability: 'webvue.internal', pinned: true },
    { id: 'chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', to: '/chat', capability: 'webvue.internal' },
  ],
  commands: [
    { id: 'chat.new-conversation', labelKey: 'nav.newConversation', icon: 'i-lucide-message-circle', to: '/chat/new', capability: 'webvue.internal' },
  ],
  sidebarPanel: { module: 'chat', width: 'wide', load: () => import('../../components/chat/ChatSidebarPanel.vue') },
  routeCapabilities: [{ pattern: /^\/chat(?:\/|$)/, capability: 'webvue.internal' }],
  capabilityAliases: { 'webvue.internal': 'chat.enabled' },
  returnToPaths: ['/chat'],
  isNavActive: (path, target) => (target === '/chat' && path.startsWith('/chat/new') ? false : undefined),
}
export default manifest
