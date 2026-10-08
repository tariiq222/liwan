import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'meetings',
  feature: 'meetings.enabled',
  routePrefixes: ['/meetings'],
  rail: [{ id: 'meetings', labelKey: 'nav.meetings', icon: 'i-lucide-calendar-days', to: '/meetings', order: 30 }],
  nav: [],
  landing: [
    { path: '/meetings', capability: 'meetings.read' },
    { path: '/meetings/calendar', capability: 'meetings.read' },
    { path: '/meetings/series', capability: 'meetings.read' },
  ],
  routeCapabilities: [
    { pattern: /^\/meetings\/new$/, capability: 'meetings.create' },
    { pattern: /^\/meetings\/series\/new$/, capability: 'meetings.create' },
    { pattern: /^\/meetings\/[^/]+\/(edit|resolutions\/new)$/, capability: 'meetings.read' },
  ],
  bell: { capabilities: ['meetings.read'] },
  isNavActive(path, target) {
    if (target === '/meetings') {
      if (path.startsWith('/meetings/calendar') || path.startsWith('/meetings/series')) return false
      return undefined
    }
    if (target === '/meetings/calendar') return path === '/meetings/calendar'
    if (target === '/meetings/series') return path === '/meetings/series' || path.startsWith('/meetings/series/')
    return undefined
  },
}
export default manifest
