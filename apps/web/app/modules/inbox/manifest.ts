import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'inbox',
  feature: 'inbox.enabled',
  routePrefixes: ['/inbox'],
  rail: [{ id: 'inbox', labelKey: 'inbox.title', shortLabelKey: 'inbox.railLabel', icon: 'i-lucide-inbox', to: '/inbox', order: 90 }],
  nav: [
    { to: '/inbox', labelKey: 'inbox.nav.conversations', icon: 'i-lucide-inbox', shortcut: 't', capability: 'inbox.conversations.read' },
  ],
  settings: {
    id: 'inbox', labelKey: 'inbox.title', icon: 'i-lucide-inbox', to: '/settings/apps/inbox',
    parts: [
      { id: 'policy', labelKey: 'inbox.settings.policy.title', icon: 'i-lucide-shield-check', capability: 'inbox.settings.manage' },
      { id: 'presets', labelKey: 'inbox.settings.presets.title', icon: 'i-lucide-wand-sparkles', capability: 'inbox.settings.manage' },
      { id: 'departments', labelKey: 'inbox.settings.departments.title', icon: 'i-lucide-network', capability: 'inbox.settings.manage' },
      { id: 'tags', labelKey: 'inbox.settings.tags.title', icon: 'i-lucide-tags', capability: 'inbox.settings.manage' },
      { id: 'canned-replies', labelKey: 'inbox.settings.canned.title', icon: 'i-lucide-message-square-quote', capability: 'inbox.settings.manage' },
      { id: 'channels', labelKey: 'inbox.settings.channels.title', icon: 'i-lucide-plug-zap', capability: 'inbox.channels.manage', within: '/settings/apps/inbox/channels' },
    ],
  },
  sidebarPanel: { module: 'inbox', width: 'wide', load: () => import('../../components/inbox/InboxSidebarPanel.vue') },
  contextLinks: () => [
    { id: 'inbox-conversations', labelKey: 'inbox.nav.conversations', icon: 'i-lucide-inbox', to: '/inbox', capability: 'inbox.conversations.read' },
  ],
  landing: [{ path: '/inbox', capability: 'inbox.conversations.read' }],
  routeCapabilities: [
    { pattern: /^\/inbox(?:\/|$)/, capability: 'inbox.conversations.read' },
    // A templates-only manager has no channel administration, so the template pages are not under the channels part's capability.
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/templates\/new$/, capability: 'inbox.templates.manage', feature: 'inbox.templates' },
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/templates(?:\/|$)/, capability: 'webvue.internal', anyCapabilities: ['inbox.templates.manage', 'inbox.channels.manage'] },
  ],
  bell: {
    capabilities: ['inbox.conversations.read'],
    kinds: [{ kind: 'inbox.assigned', href: row => `/inbox/${row.conversation_id}` }],
  },
}
export default manifest
