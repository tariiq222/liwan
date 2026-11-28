import type { AppManifest } from '../types'

/**
 * The telephony application's web surface. Everything here is data: the shell discovers this file, so no navigation
 * or `nuxt.config.ts` change is needed (web-rules). `telephony.use` gates the call log; the settings page has two parts,
 * the extensions and the recording settings, and both need `telephony.manage`.
 */
const manifest: AppManifest = {
  id: 'telephony',
  feature: 'telephony.enabled',
  routePrefixes: ['/calls'],
  rail: [{ id: 'telephony', labelKey: 'telephony.title', icon: 'i-lucide-phone', to: '/calls', order: 110 }],
  nav: [
    { to: '/calls', labelKey: 'telephony.nav.calls', icon: 'i-lucide-phone-call', shortcut: '', capability: 'telephony.use' },
  ],
  appCard: { category: 'sales', plan: 'addon' },
  contextLinks: () => [
    { id: 'telephony-calls', labelKey: 'telephony.nav.calls', icon: 'i-lucide-phone-call', to: '/calls', capability: 'telephony.use' },
  ],
  landing: [{ path: '/calls', capability: 'telephony.use' }],
  routeCapabilities: [{ pattern: /^\/calls(?:\/|$)/, capability: 'telephony.use' }],
  callChip: {
    capability: 'telephony.use',
    load: () => import('../../composables/telephony/createCallChip'),
  },
  settings: {
    id: 'telephony',
    labelKey: 'telephony.title',
    icon: 'i-lucide-phone',
    to: '/settings/apps/telephony',
    parts: [
      { id: 'extensions', labelKey: 'telephony.settings.extensions', icon: 'i-lucide-headset', capability: 'telephony.manage' },
      { id: 'recording', labelKey: 'telephony.settings.recording', icon: 'i-lucide-mic', capability: 'telephony.manage' },
    ],
  },
}
export default manifest
