import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'crm',
  feature: 'crm.enabled',
  routePrefixes: ['/crm'],
  rail: [{ id: 'crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', to: '/crm', order: 85 }],
  nav: [
    { to: '/crm', labelKey: 'crm.nav.dashboard', icon: 'i-lucide-layout-dashboard', shortcut: 'x', capability: 'crm.leads.read' },
    { to: '/crm/opportunities', labelKey: 'crm.nav.opportunities', icon: 'i-lucide-handshake', shortcut: '', capability: 'crm.leads.read' },
    { to: '/crm/imports', labelKey: 'crm.nav.imports', icon: 'i-lucide-file-up', shortcut: '', capability: 'crm.leads.import' },
  ],
  settings: {
    id: 'crm', labelKey: 'nav.crm', icon: 'i-lucide-handshake', to: '/settings/apps/crm',
    parts: [
      { id: 'preset', labelKey: 'crm.settings.preset.title', icon: 'i-lucide-wand-sparkles', capability: 'crm.settings.read' },
      { id: 'terms', labelKey: 'crm.settings.terms.title', icon: 'i-lucide-spell-check', capability: 'crm.settings.read' },
      { id: 'followup', labelKey: 'crm.settings.followup.title', icon: 'i-lucide-phone-forwarded', capability: 'crm.settings.read' },
      { id: 'distribution', labelKey: 'crm.settings.distribution.title', icon: 'i-lucide-shuffle', capability: 'crm.settings.read' },
      { id: 'privacy', labelKey: 'crm.settings.privacy.title', icon: 'i-lucide-shield-check', capability: 'crm.settings.read' },
      { id: 'pricing', labelKey: 'crm.settings.pricing.title', icon: 'i-lucide-percent', capability: 'crm.settings.read' },
      { id: 'packages', labelKey: 'crm.settings.packages.title', icon: 'i-lucide-package', capability: 'crm.settings.read' },
      { id: 'stages', labelKey: 'crm.settings.stages.title', icon: 'i-lucide-columns-3', capability: 'crm.settings.read' },
      { id: 'outcomes', labelKey: 'crm.settings.outcomes.title', icon: 'i-lucide-phone-call', capability: 'crm.settings.read' },
      { id: 'lostReasons', labelKey: 'crm.settings.lostReasons.title', icon: 'i-lucide-circle-x', capability: 'crm.settings.read' },
      { id: 'sources', labelKey: 'crm.settings.sources.title', icon: 'i-lucide-radio-tower', capability: 'crm.settings.read' },
    ],
  },
  contextLinks: () => [
    { id: 'crm-dashboard', labelKey: 'crm.nav.dashboard', icon: 'i-lucide-layout-dashboard', to: '/crm', capability: 'crm.leads.read', exact: true },
    { id: 'crm-opportunities', labelKey: 'crm.nav.opportunities', icon: 'i-lucide-handshake', to: '/crm/opportunities', capability: 'crm.leads.read' },
    { id: 'crm-imports', labelKey: 'crm.nav.imports', icon: 'i-lucide-file-up', to: '/crm/imports', capability: 'crm.leads.import' },
  ],
  landing: [{ path: '/crm', capability: 'crm.leads.read' }],
  routeCapabilities: [
    { pattern: /^\/crm\/opportunities\/new$/, capability: 'crm.leads.work' },
    { pattern: /^\/crm\/imports\/new$/, capability: 'crm.leads.import' },
    { pattern: /^\/crm\/imports(?:\/|$)/, capability: 'crm.leads.import' },
    { pattern: /^\/crm(?:\/|$)/, capability: 'crm.leads.read' },
  ],
  bell: {
    capabilities: ['crm.leads.read'],
    kinds: ['crm.assigned', 'crm.followup_due'].map(kind => ({ kind, href: row => (typeof row.opportunity_id === 'number' ? `/crm/opportunities/${row.opportunity_id}` : null) })),
  },
}
export default manifest
