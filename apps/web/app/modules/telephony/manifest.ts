import type { AppManifest } from '../types'

/**
 * The telephony application's web surface. Everything here is data: the shell discovers this file, so no navigation
 * or `nuxt.config.ts` change is needed (web-rules). `telephony.use` gates the call log, and the settings part needs
 * `telephony.manage`.
 */
const manifest: AppManifest = {
  id: 'telephony',
  feature: 'telephony.enabled',
  routePrefixes: ['/calls'],
  rail: [{ id: 'telephony', labelKey: 'telephony.title', icon: 'i-lucide-phone', to: '/calls', order: 110 }],
  nav: [
    { to: '/calls', labelKey: 'telephony.nav.calls', icon: 'i-lucide-phone-call', shortcut: '0', capability: 'telephony.use' },
  ],
  contextLinks: () => [
    { id: 'telephony-calls', labelKey: 'telephony.nav.calls', icon: 'i-lucide-phone-call', to: '/calls', capability: 'telephony.use' },
  ],
  landing: [{ path: '/calls', capability: 'telephony.use' }],
  routeCapabilities: [{ pattern: /^\/calls(?:\/|$)/, capability: 'telephony.use' }],
  settings: {
    id: 'telephony',
    labelKey: 'telephony.title',
    icon: 'i-lucide-phone',
    to: '/settings/apps/telephony',
    parts: [
      { id: 'lines', labelKey: 'telephony.settings.lines', icon: 'i-lucide-cable', capability: 'telephony.manage' },
      { id: 'routing', labelKey: 'telephony.settings.routing', icon: 'i-lucide-git-branch', capability: 'telephony.manage' },
      { id: 'extensions', labelKey: 'telephony.settings.extensions', icon: 'i-lucide-headset', capability: 'telephony.manage' },
      { id: 'recording', labelKey: 'telephony.settings.recording', icon: 'i-lucide-mic', capability: 'telephony.manage' },
    ],
  },
}
export default manifest
