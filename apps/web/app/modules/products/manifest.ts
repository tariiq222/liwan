import type { AppManifest } from '../types'

// Products is a shared service with a list of its own and a settings page. The tenant does not buy it: the server derives
// `products.enabled` from the applications that use products and carries it in the platform features while the service is
// open. Without it the rail entry, the home card and the routes are closed, and a read-only tenant (the key readable but
// not writable) keeps the pages but loses create, edit and settings. The folder is not registered in `web_apps`, so every
// application may use the product picker.
const manifest: AppManifest = {
  id: 'products',
  feature: 'products.enabled',
  routePrefixes: ['/products'],
  appCard: { category: 'sales', plan: 'included', surface: 'sand' },
  rail: [{ id: 'products', labelKey: 'products.title', icon: 'i-lucide-package', to: '/products', order: 89 }],
  nav: [{ to: '/products', labelKey: 'products.title', icon: 'i-lucide-package', shortcut: '', capability: 'products.read' }],
  settings: {
    id: 'products', labelKey: 'products.title', icon: 'i-lucide-package', to: '/settings/apps/products',
    parts: [
      { id: 'sharing', labelKey: 'products.settings.sharing.title', icon: 'i-lucide-share-2', capability: 'products.settings.manage' },
    ],
  },
  contextLinks: () => [
    { id: 'new-product', labelKey: 'products.new', icon: 'i-lucide-plus', to: '/products/new', capability: 'products.manage', pinned: true },
    { id: 'products', labelKey: 'products.title', icon: 'i-lucide-package', to: '/products', capability: 'products.read' },
  ],
  landing: [{ path: '/products', capability: 'products.read' }],
  commands: [{ id: 'products.new-product', labelKey: 'products.new', icon: 'i-lucide-package', to: '/products/new', capability: 'products.manage' }],
  routeCapabilities: [
    { pattern: /^\/products\/new$/, capability: 'products.manage' },
    // A holder of the price right alone may open the edit page: it lets them change the price and nothing else.
    { pattern: /^\/products\/[^/]+\/edit$/, capability: 'products.read', anyCapabilities: ['products.manage', 'products.prices.manage'] },
    { pattern: /^\/products(?:\/|$)/, capability: 'products.read' },
  ],
}
export default manifest
