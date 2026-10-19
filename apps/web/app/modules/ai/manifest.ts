import type { AppManifest } from '../types'

// Opening the page needs the capability `ai.use` (issued by Odoo) and the feature `ai.enabled`
// (derived from the `ai.` prefix); what the assistant may do is decided per tool by Odoo.
const manifest: AppManifest = {
  id: 'ai',
  feature: 'ai.enabled',
  routePrefixes: ['/ai'],
  rail: [{ id: 'ai', labelKey: 'nav.ai', icon: 'i-lucide-sparkles', to: '/ai', order: 60, accent: 'rose' }],
  nav: [
    { to: '/ai', labelKey: 'nav.ai', icon: 'i-lucide-sparkles', shortcut: 'q', goKey: 'i', capability: 'ai.use' },
  ],
  sidebarPanel: { module: 'ai', width: 'default', load: () => import('../../components/ai/AiRunList.vue') },
  landing: [{ path: '/ai', capability: 'ai.use', late: true }],
  returnToPaths: ['/ai'],
}
export default manifest
