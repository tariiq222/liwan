import type { AppManifest } from '../types'

// Sales: staff quotations and orders, and the online orders other channels made (read-only here). The tenant buys it as
// its own application behind `sales.enabled`. Writing a quotation is `sales.quotations.manage`; the record page shows
// only the moves the server reports in `order.actions`.
const manifest: AppManifest = {
  id: 'sales',
  feature: 'sales.enabled',
  routePrefixes: ['/sales'],
  appCard: { category: 'sales', plan: 'addon', surface: 'sand' },
  rail: [{ id: 'sales', labelKey: 'sales.title', icon: 'i-lucide-receipt-text', to: '/sales', order: 87 }],
  nav: [{ to: '/sales', labelKey: 'sales.title', icon: 'i-lucide-receipt-text', shortcut: '', capability: 'sales.read' }],
  settings: {
    id: 'sales', labelKey: 'sales.title', icon: 'i-lucide-receipt-text', to: '/settings/apps/sales',
    parts: [
      { id: 'visibility', labelKey: 'sales.settings.visibility.title', icon: 'i-lucide-eye', capability: 'sales.settings.manage' },
      { id: 'quotations', labelKey: 'sales.settings.quotations.title', icon: 'i-lucide-file-text', capability: 'sales.settings.manage' },
    ],
  },
  contextLinks: () => [
    { id: 'new-quotation', labelKey: 'sales.new', icon: 'i-lucide-plus', to: '/sales/new', capability: 'sales.quotations.manage', pinned: true },
    { id: 'sales', labelKey: 'sales.title', icon: 'i-lucide-receipt-text', to: '/sales', capability: 'sales.read' },
  ],
  landing: [{ path: '/sales', capability: 'sales.read' }],
  commands: [{ id: 'sales.new-quotation', labelKey: 'sales.new', icon: 'i-lucide-receipt-text', to: '/sales/new', capability: 'sales.quotations.manage' }],
  routeCapabilities: [
    { pattern: /^\/sales\/new$/, capability: 'sales.quotations.manage' },
    { pattern: /^\/sales\/[^/]+\/edit$/, capability: 'sales.quotations.manage' },
    { pattern: /^\/sales(?:\/|$)/, capability: 'sales.read' },
  ],
}
export default manifest
