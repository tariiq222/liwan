import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'chat',
  feature: 'chat.enabled',
  routePrefixes: ['/chat'],
  rail: [{ id: 'chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', to: '/chat', order: 40 }],
  nav: [
    { to: '/chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', shortcut: 'c', capability: 'nasq.internal' },
  ],
  contextLinks: () => [
    { id: 'new-chat', labelKey: 'nav.newConversation', icon: 'i-lucide-plus', to: '/chat/new', capability: 'nasq.internal', pinned: true },
    { id: 'chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', to: '/chat', capability: 'nasq.internal' },
  ],
  routeCapabilities: [{ pattern: /^\/chat(?:\/|$)/, capability: 'nasq.internal' }],
  capabilityAliases: { 'nasq.internal': 'chat.enabled' },
  returnToPaths: ['/chat'],
  isNavActive: (path, target) => (target === '/chat' && path.startsWith('/chat/new') ? false : undefined),
}
export default manifest
