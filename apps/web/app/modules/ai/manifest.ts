import type { AppManifest } from '../types'

// Opening the page needs the capability `ai.use` (issued by Odoo) and the feature `ai.enabled`
// (derived from the `ai.` prefix); what the assistant may do is decided per tool by Odoo.
const manifest: AppManifest = {
  id: 'ai',
  feature: 'ai.enabled',
  routePrefixes: ['/ai'],
  rail: [{ id: 'ai', labelKey: 'nav.ai', shortLabelKey: 'nav.rail.ai', icon: 'i-lucide-sparkles', to: '/ai', order: 60, utility: true }],
  nav: [
    { to: '/ai', labelKey: 'nav.ai', icon: 'i-lucide-sparkles', shortcut: 'q', goKey: 'i', capability: 'ai.use' },
  ],
  sidebarPanel: { module: 'ai', width: 'default', load: () => import('../../components/ai/AiRunList.vue') },
  assistant: { capability: 'ai.use', labelKey: 'nav.ai', to: '/ai', load: () => import('../../components/ai/AiSheet.vue') },
  landing: [{ path: '/ai', capability: 'ai.use', late: true }],
  returnToPaths: ['/ai'],
  // The tenant administrator's AI settings (`ai.settings.manage`): provider, residency consent, retention, agents and usage.
  settings: {
    id: 'ai', labelKey: 'ai.settings.title', icon: 'i-lucide-sparkles', to: '/settings/apps/ai',
    parts: [
      { id: 'provider', labelKey: 'ai.settings.provider.title', icon: 'i-lucide-plug-zap', capability: 'ai.settings.manage' },
      { id: 'residency', labelKey: 'ai.settings.residency.title', icon: 'i-lucide-globe-lock', capability: 'ai.settings.manage' },
      { id: 'retention', labelKey: 'ai.settings.retention.title', icon: 'i-lucide-history', capability: 'ai.settings.manage' },
      { id: 'agents', labelKey: 'ai.settings.agents.title', icon: 'i-lucide-bot', capability: 'ai.settings.manage' },
      { id: 'memory', labelKey: 'ai.settings.companyMemory.title', icon: 'i-lucide-brain', capability: 'ai.settings.manage' },
      { id: 'usage', labelKey: 'ai.settings.usage.title', icon: 'i-lucide-gauge', capability: 'ai.settings.manage' },
    ],
  },
}
export default manifest
