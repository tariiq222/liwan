import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'inbox',
  feature: 'inbox.enabled',
  routePrefixes: ['/inbox'],
  rail: [{ id: 'inbox', labelKey: 'inbox.title', shortLabelKey: 'inbox.railLabel', icon: 'i-lucide-inbox', to: '/inbox', order: 90 }],
  nav: [
    { to: '/inbox', labelKey: 'inbox.nav.conversations', icon: 'i-lucide-inbox', shortcut: 't', capability: 'inbox.conversations.read' },
    { to: '/inbox/reports', labelKey: 'inbox.nav.reports', icon: 'i-lucide-chart-column', shortcut: '', capability: 'inbox.reports.read', feature: 'inbox.reports' },
  ],
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
      { id: 'channels', labelKey: 'inbox.settings.channels.title', icon: 'i-lucide-plug-zap', capability: 'inbox.channels.manage', within: '/settings/apps/inbox/channels' },
    ],
  },
  sidebarPanel: { module: 'inbox', width: 'wide', load: () => import('../../components/inbox/InboxSidebarPanel.vue') },
  contextLinks: () => [
    { id: 'inbox-conversations', labelKey: 'inbox.nav.conversations', icon: 'i-lucide-inbox', to: '/inbox', capability: 'inbox.conversations.read' },
    { id: 'inbox-reports', labelKey: 'inbox.nav.reports', icon: 'i-lucide-chart-column', to: '/inbox/reports', capability: 'inbox.reports.read', feature: 'inbox.reports' },
  ],
  landing: [
    { path: '/inbox', capability: 'inbox.conversations.read' },
    { path: '/inbox/reports', capability: 'inbox.reports.read' },
  ],
  // The conversations item is not lit on the reports pages, which have their own item.
  isNavActive: (path, target) => (target === '/inbox' && /^\/inbox\/reports(?:\/|$)/.test(path) ? false : undefined),
  routeCapabilities: [
    // Reports are agent-performance data: their own capability and sub-feature, matched before the generic inbox rule.
    { pattern: /^\/inbox\/reports(?:\/|$)/, capability: 'inbox.reports.read', feature: 'inbox.reports' },
    { pattern: /^\/inbox(?:\/|$)/, capability: 'inbox.conversations.read' },
    // A templates-only manager has no channel administration, so the template pages are not under the channels part's capability.
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/templates\/new$/, capability: 'inbox.templates.manage', feature: 'inbox.templates' },
    // The same for forms: a forms-only manager has no channel administration.
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/flows\/new$/, capability: 'inbox.flows.manage', feature: 'inbox.flows' },
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/flows(?:\/|$)/, capability: 'webvue.internal', anyCapabilities: ['inbox.flows.manage', 'inbox.channels.manage'] },
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/templates(?:\/|$)/, capability: 'webvue.internal', anyCapabilities: ['inbox.templates.manage', 'inbox.channels.manage'] },
  ],
  bell: {
    capabilities: ['inbox.conversations.read', 'inbox.channels.manage'],
    kinds: [
      { kind: 'inbox.assigned', href: row => `/inbox/${row.conversation_id}` },
      { kind: 'inbox.first_response', href: row => `/inbox/${row.conversation_id}` },
      // Number health rings only for warnings and dangers, and only for the channel managers.
      { kind: 'inbox.channel_health', href: row => `/settings/apps/inbox/channels/${row.channel_id}/health`, title: row => String(row.title) },
    ],
  },
}
export default manifest
