import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'chat',
  feature: 'chat.enabled',
  routePrefixes: ['/chat'],
  rail: [{ id: 'chat', labelKey: 'nav.chat', icon: 'i-lucide-message-circle', to: '/chat', order: 40 }],
  nav: [],
  routeCapabilities: [{ pattern: /^\/chat(?:\/|$)/, capability: 'nasq.internal' }],
  capabilityAliases: { 'nasq.internal': 'chat.enabled' },
  returnToPaths: ['/chat'],
}
export default manifest
