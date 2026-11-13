import type { AppManifest } from '../types'

// Customers is a shared service with a directory of its own and a settings page. The tenant does not buy it: the server
// derives `customers.enabled` from the applications that use customers and carries it in the platform features while
// the service is open. Without it the rail entry, the home card and the routes are closed, and a read-only tenant
// (the key readable but not writable) keeps the pages but loses create, edit and settings.
const manifest: AppManifest = {
  id: 'customers',
  feature: 'customers.enabled',
  routePrefixes: ['/customers'],
  appCard: { category: 'sales', plan: 'included', surface: 'mint' },
  rail: [{ id: 'customers', labelKey: 'customers.title', icon: 'i-lucide-contact-round', to: '/customers', order: 88 }],
  nav: [{ to: '/customers', labelKey: 'customers.title', icon: 'i-lucide-contact-round', shortcut: '4', capability: 'customers.read' }],
  settings: {
    id: 'customers', labelKey: 'customers.title', icon: 'i-lucide-contact-round', to: '/settings/apps/customers',
    parts: [
      { id: 'sharing', labelKey: 'customers.settings.sharing.title', icon: 'i-lucide-share-2', capability: 'customers.settings.manage' },
      { id: 'partyKinds', labelKey: 'customers.settings.partyKinds.title', icon: 'i-lucide-users-round', capability: 'customers.settings.manage' },
      { id: 'phoneCountry', labelKey: 'customers.settings.phoneCountry.title', icon: 'i-lucide-phone', capability: 'customers.settings.manage' },
      { id: 'fields', labelKey: 'customers.settings.fields.title', icon: 'i-lucide-list-plus', capability: 'customers.settings.manage' },
    ],
  },
  contextLinks: () => [
    { id: 'new-customer', labelKey: 'customers.new', icon: 'i-lucide-plus', to: '/customers/new', capability: 'customers.manage', pinned: true },
    { id: 'customers', labelKey: 'customers.title', icon: 'i-lucide-contact-round', to: '/customers', capability: 'customers.read' },
  ],
  landing: [{ path: '/customers', capability: 'customers.read' }],
  commands: [{ id: 'customers.new-customer', labelKey: 'customers.new', icon: 'i-lucide-contact-round', to: '/customers/new', capability: 'customers.manage' }],
  routeCapabilities: [
    { pattern: /^\/customers\/new$/, capability: 'customers.manage' },
    { pattern: /^\/customers\/[^/]+\/edit$/, capability: 'customers.manage' },
    { pattern: /^\/customers(?:\/|$)/, capability: 'customers.read' },
  ],
}
export default manifest
