import type { AppManifest } from '../types'
import { inboxAppCard } from './appCard'

const manifest: AppManifest = {
  id: 'inbox',
  feature: 'inbox.enabled',
  routePrefixes: ['/inbox'],
  rail: [{ id: 'inbox', labelKey: 'inbox.title', shortLabelKey: 'inbox.railLabel', icon: 'i-lucide-messages-square', to: '/inbox', order: 90 }],
  nav: [
    { to: '/inbox', labelKey: 'inbox.nav.conversations', icon: 'i-lucide-messages-square', shortcut: 't', capability: 'inbox.conversations.read' },
    { to: '/inbox/campaigns', labelKey: 'inbox.nav.campaigns', icon: 'i-lucide-megaphone', shortcut: '', capability: 'inbox.campaigns.manage', feature: 'inbox.campaigns' },
    { to: '/inbox/reports', labelKey: 'inbox.nav.reports', icon: 'i-lucide-chart-column', shortcut: '', capability: 'inbox.reports.read', feature: 'inbox.reports' },
    { to: '/inbox/orders', labelKey: 'inbox.nav.orders', icon: 'i-lucide-shopping-cart', shortcut: '', capability: 'inbox.conversations.read', feature: 'inbox.catalog' },
  ],
  // Every area capability also needs its own sub-feature beside `inbox.enabled`, exactly as the server gates it:
  // a tenant that switched templates, forms, automation, reports or campaigns off gets no entry or route for them.
  subFeatures: {
    'inbox.catalog.': 'inbox.catalog', 'inbox.orders.': 'inbox.catalog',
    'inbox.templates.': 'inbox.templates', 'inbox.flows.': 'inbox.flows',
    'inbox.automation.': 'inbox.automation', 'inbox.reports.': 'inbox.reports',
    'inbox.campaigns.': 'inbox.campaigns',
  },
  settings: {
    id: 'inbox', labelKey: 'inbox.title', icon: 'i-lucide-messages-square', to: '/settings/apps/inbox',
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
      { id: 'campaigns', labelKey: 'inbox.campaigns.settings.title', icon: 'i-lucide-megaphone', capability: 'inbox.campaigns.manage' },
      // Channel administration, or the read-only reference list of the channels a templates, forms or automation
      // manager may work on; those roles never receive channel administration.
      { id: 'channels', labelKey: 'inbox.settings.channels.title', icon: 'i-lucide-plug-zap', capability: 'inbox.channels.manage', anyCapabilities: ['inbox.templates.manage', 'inbox.flows.manage', 'inbox.automation.manage'], within: '/settings/apps/inbox/channels', navTo: '/settings/apps/inbox#channels' },
    ],
    // The page's tabs; the presets sit above them, and the parts with a page of their own stay in the sidebar.
    groups: [
      { id: 'basics', labelKey: 'inbox.settings.groups.basics', parts: ['policy', 'departments', 'tags'] },
      { id: 'replies', labelKey: 'inbox.settings.groups.replies', parts: ['canned-replies', 'auto-messages', 'campaigns'] },
      { id: 'channels', labelKey: 'inbox.settings.groups.channels', parts: ['channels'] },
    ],
  },
  appCard: inboxAppCard,
  contextLinks: () => [
    { id: 'inbox-conversations', labelKey: 'inbox.nav.conversations', icon: 'i-lucide-messages-square', to: '/inbox', capability: 'inbox.conversations.read' },
    { id: 'inbox-campaigns', labelKey: 'inbox.nav.campaigns', icon: 'i-lucide-megaphone', to: '/inbox/campaigns', capability: 'inbox.campaigns.manage', feature: 'inbox.campaigns' },
    { id: 'inbox-reports', labelKey: 'inbox.nav.reports', icon: 'i-lucide-chart-column', to: '/inbox/reports', capability: 'inbox.reports.read', feature: 'inbox.reports' },
    { id: 'inbox-orders', labelKey: 'inbox.nav.orders', icon: 'i-lucide-shopping-cart', to: '/inbox/orders', capability: 'inbox.conversations.read', feature: 'inbox.catalog' },
  ],
  landing: [
    { path: '/inbox', capability: 'inbox.conversations.read' },
    { path: '/inbox/campaigns', capability: 'inbox.campaigns.manage' },
    { path: '/inbox/reports', capability: 'inbox.reports.read' },
  ],
  // The conversations item is not lit on the campaigns, reports or orders pages, which have their own items.
  isNavActive: (path, target) => (target === '/inbox' && /^\/inbox\/(?:campaigns|reports|orders)(?:\/|$)/.test(path) ? false : undefined),
  routeCapabilities: [
    // Campaigns have their own capability and sub-feature, matched before the generic inbox rule.
    { pattern: /^\/inbox\/campaigns(?:\/|$)/, capability: 'inbox.campaigns.manage', feature: 'inbox.campaigns' },
    // Reports are agent-performance data: their own capability and sub-feature, matched before the generic inbox rule.
    { pattern: /^\/inbox\/reports(?:\/|$)/, capability: 'inbox.reports.read', feature: 'inbox.reports' },
    // First match wins: the orders page needs the catalog feature besides reading conversations.
    { pattern: /^\/inbox\/orders(?:\/|$)/, capability: 'inbox.conversations.read', feature: 'inbox.catalog' },
    { pattern: /^\/inbox(?:\/|$)/, capability: 'inbox.conversations.read' },
    { pattern: /^\/settings\/apps\/inbox\/catalog(?:\/|$)/, capability: 'inbox.catalog.manage', feature: 'inbox.catalog' },
    // Connecting a WhatsApp number needs that channel kind, exactly as the create route checks it.
    { pattern: /^\/settings\/apps\/inbox\/channels\/new$/, capability: 'inbox.channels.manage', feature: 'inbox.whatsapp' },
    // A templates-only manager has no channel administration, so the template pages are not under the channels part's
    // capability; both the feature and the page's own capability decide, and the server checks the same pair.
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/templates\/new$/, capability: 'inbox.templates.manage', feature: 'inbox.templates' },
    // The same for forms: a forms-only manager has no channel administration.
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/flows\/new$/, capability: 'inbox.flows.manage', feature: 'inbox.flows' },
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/automation$/, capability: 'inbox.automation.manage', feature: 'inbox.automation' },
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/flows(?:\/|$)/, capability: 'liwan.internal', anyCapabilities: ['inbox.flows.manage', 'inbox.channels.manage'], feature: 'inbox.flows' },
    { pattern: /^\/settings\/apps\/inbox\/channels\/[^/]+\/templates(?:\/|$)/, capability: 'liwan.internal', anyCapabilities: ['inbox.templates.manage', 'inbox.channels.manage'], feature: 'inbox.templates' },
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
