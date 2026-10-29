import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'inbox',
  feature: 'inbox.enabled',
  routePrefixes: ['/inbox'],
  rail: [{ id: 'inbox', labelKey: 'inbox.title', shortLabelKey: 'inbox.railLabel', icon: 'i-lucide-inbox', to: '/inbox', order: 90 }],
  nav: [
    { to: '/inbox', labelKey: 'inbox.nav.conversations', icon: 'i-lucide-inbox', shortcut: 't', capability: 'inbox.conversations.read' },
    { to: '/inbox/orders', labelKey: 'inbox.nav.orders', icon: 'i-lucide-shopping-cart', shortcut: '', capability: 'inbox.conversations.read', feature: 'inbox.catalog' },
  ],
  // The catalog and its orders are the `inbox.catalog` sub-feature: their capabilities need it besides `inbox.enabled`.
  subFeatures: { 'inbox.catalog.': 'inbox.catalog', 'inbox.orders.': 'inbox.catalog' },
  isNavActive: (path, target) => (target === '/inbox' && /^\/inbox\/orders(?:\/|$)/.test(path) ? false : undefined),
  settings: {
    id: 'inbox', labelKey: 'inbox.title', icon: 'i-lucide-inbox', to: '/settings/apps/inbox',
    parts: [
      { id: 'policy', labelKey: 'inbox.settings.policy.title', icon: 'i-lucide-shield-check', capability: 'inbox.settings.manage' },
      { id: 'presets', labelKey: 'inbox.settings.presets.title', icon: 'i-lucide-wand-sparkles', capability: 'inbox.settings.manage' },
      { id: 'departments', labelKey: 'inbox.settings.departments.title', icon: 'i-lucide-network', capability: 'inbox.settings.manage' },
      { id: 'tags', labelKey: 'inbox.settings.tags.title', icon: 'i-lucide-tags', capability: 'inbox.settings.manage' },
      { id: 'canned-replies', labelKey: 'inbox.settings.canned.title', icon: 'i-lucide-message-square-quote', capability: 'inbox.settings.manage' },
      { id: 'working-hours', labelKey: 'inbox.automation.hours.title', icon: 'i-lucide-clock', capability: 'inbox.automation.manage', to: '/settings/apps/inbox/working-hours', within: '/settings/apps/inbox/working-hours' },
      { id: 'rules', labelKey: 'inbox.automation.rules.title', icon: 'i-lucide-list-checks', capability: 'inbox.automation.manage', to: '/settings/apps/inbox/rules', within: '/settings/apps/inbox/rules' },
      { id: 'auto-messages', labelKey: 'inbox.automation.messages.title', icon: 'i-lucide-bot-message-square', capability: 'inbox.automation.manage', within: '/settings/apps/inbox/auto-messages' },
      { id: 'catalog', labelKey: 'inbox.catalog.title', icon: 'i-lucide-store', capability: 'inbox.catalog.manage', to: '/settings/apps/inbox/catalog', within: '/settings/apps/inbox/catalog' },
      { id: 'channels', labelKey: 'inbox.settings.channels.title', icon: 'i-lucide-plug-zap', capability: 'inbox.channels.manage', within: '/settings/apps/inbox/channels' },
    ],
  },
  sidebarPanel: { module: 'inbox', width: 'wide', load: () => import('../../components/inbox/InboxSidebarPanel.vue') },
  contextLinks: () => [
    { id: 'inbox-conversations', labelKey: 'inbox.nav.conversations', icon: 'i-lucide-inbox', to: '/inbox', capability: 'inbox.conversations.read' },
  ],
  landing: [{ path: '/inbox', capability: 'inbox.conversations.read' }],
  routeCapabilities: [
    // First match wins: the orders page needs the catalog feature besides reading conversations.
    { pattern: /^\/inbox\/orders(?:\/|$)/, capability: 'inbox.conversations.read', feature: 'inbox.catalog' },
    { pattern: /^\/inbox(?:\/|$)/, capability: 'inbox.conversations.read' },
    { pattern: /^\/settings\/apps\/inbox\/catalog(?:\/|$)/, capability: 'inbox.catalog.manage', feature: 'inbox.catalog' },
    // A templates-only manager has no channel administration, so the template pages are not under the channels part's capability.
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/templates\/new$/, capability: 'inbox.templates.manage', feature: 'inbox.templates' },
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/templates(?:\/|$)/, capability: 'webvue.internal', anyCapabilities: ['inbox.templates.manage', 'inbox.channels.manage'] },
  ],
  bell: {
    capabilities: ['inbox.conversations.read'],
    kinds: [
      { kind: 'inbox.assigned', href: row => `/inbox/${row.conversation_id}` },
      { kind: 'inbox.first_response', href: row => `/inbox/${row.conversation_id}` },
    ],
  },
}
export default manifest
