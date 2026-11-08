import type { AppManifest } from '../types'

// Opening the page needs the capability `ai.use` (issued by Odoo) and the feature `ai.enabled`
// (derived from the `ai.` prefix); what the assistant may do is decided per tool by Odoo.
const manifest: AppManifest = {
  id: 'ai',
  feature: 'ai.enabled',
  routePrefixes: ['/ai'],
  rail: [{ id: 'ai', labelKey: 'nav.ai', shortLabelKey: 'nav.rail.ai', icon: 'i-lucide-sparkles', to: '/ai', order: 60, fixed: 'top' }],
  nav: [
    { to: '/ai', labelKey: 'nav.ai', icon: 'i-lucide-sparkles', shortcut: 'q', goKey: 'i', capability: 'ai.use' },
  ],
  sidebarPanel: { module: 'ai', width: 'default', load: () => import('../../components/ai/AiRunList.vue') },
  assistant: { capability: 'ai.use', labelKey: 'nav.ai', to: '/ai', load: () => import('../../components/ai/AiSheet.vue') },
  landing: [{ path: '/ai', capability: 'ai.use', late: true }],
  returnToPaths: ['/ai'],
  // The monthly limit warning goes to AI settings managers (the server filters by `ai.settings.manage`); it opens their settings.
  bell: { capabilities: ['ai.settings.manage'], kinds: [{ kind: 'ai.limit_warning', href: () => '/settings/apps/ai' }] },
  // The tenant administrator's AI settings (`ai.settings.manage`): provider, use acknowledgement, retention, agents and usage.
  settings: {
    id: 'ai', labelKey: 'ai.settings.title', icon: 'i-lucide-sparkles', to: '/settings/apps/ai',
    parts: [
      { id: 'provider', labelKey: 'ai.settings.provider.title', icon: 'i-lucide-plug-zap', capability: 'ai.settings.manage' },
      { id: 'consent', labelKey: 'ai.settings.consent.title', icon: 'i-lucide-file-signature', capability: 'ai.settings.manage' },
      { id: 'retention', labelKey: 'ai.settings.retention.title', icon: 'i-lucide-history', capability: 'ai.settings.manage' },
      { id: 'agents', labelKey: 'ai.settings.agents.title', icon: 'i-lucide-bot', capability: 'ai.settings.manage' },
      { id: 'knowledge', labelKey: 'ai.settings.knowledge.title', icon: 'i-lucide-library', capability: 'ai.settings.manage' },
      { id: 'memory', labelKey: 'ai.settings.companyMemory.title', icon: 'i-lucide-brain', capability: 'ai.settings.manage' },
      { id: 'usage', labelKey: 'ai.settings.usage.title', icon: 'i-lucide-gauge', capability: 'ai.settings.manage' },
    ],
  },
}
export default manifest
