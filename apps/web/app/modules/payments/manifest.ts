import type { AppManifest } from '../types'

// Payments is a shared service, not a rail application: it adds one page to Settings > Applications and nothing else.
// The capability maps to the `payments.enabled` feature (`<first segment>.enabled`) at the write level, so a tenant
// without the feature, or a read-only one, does not reach the page.
const manifest: AppManifest = {
  id: 'payments',
  feature: 'payments.enabled',
  routePrefixes: [],
  rail: [],
  nav: [],
  settings: {
    id: 'payments', labelKey: 'payments.title', icon: 'i-lucide-credit-card', to: '/settings/apps/payments',
    parts: [
      { id: 'providers', labelKey: 'payments.providers.title', icon: 'i-lucide-plug-zap', capability: 'payments.providers.manage' },
    ],
  },
}
export default manifest
