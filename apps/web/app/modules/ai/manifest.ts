import type { AppManifest } from '../types'

// Opening the page needs the capability `ai.use` (issued by Odoo) and the feature `ai.enabled`
// (derived from the `ai.` prefix); what the assistant may do is decided per tool by Odoo.
const manifest: AppManifest = {
  id: 'ai',
  feature: 'ai.enabled',
  routePrefixes: ['/ai'],
  rail: [{ id: 'ai', labelKey: 'nav.ai', shortLabelKey: 'nav.rail.ai', icon: 'i-liwan-ai', to: '/ai', order: 60, fixed: 'top', accent: true }],
  nav: [
    { to: '/ai', labelKey: 'nav.ai', icon: 'i-liwan-ai', shortcut: 'q', goKey: 'i', capability: 'ai.use' },
  ],
  sidebarPanel: { module: 'ai', width: 'default', load: () => import('../../components/ai/AiRunList.vue') },
  assistant: { capability: 'ai.use', labelKey: 'nav.ai', to: '/ai', load: () => import('../../components/ai/AiSheet.vue') },
  landing: [{ path: '/ai', capability: 'ai.use', late: true }],
  returnToPaths: ['/ai'],
  // The tenant administrator's AI settings (`ai.settings.manage`): provider, use acknowledgement, retention, agents and usage.
  settings: {
    id: 'ai', labelKey: 'ai.settings.title', icon: 'i-liwan-ai', to: '/settings/apps/ai',
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
