import { http, HttpResponse } from 'msw'
import { apiHandlers } from './api'
import { shellBranding, shellMe } from '../fixtures/shell'

/** The shell's own requests: identity, branding, the bell and the vendor-context probe (a workspace user is not a vendor). First match wins. */
export const shellHandlers = [
  http.get('/api/v1/me', () => HttpResponse.json(shellMe)),
  http.get('/api/v1/branding', () => HttpResponse.json(shellBranding)),
  http.get('/api/v1/notifications', () => HttpResponse.json({ items: [], total: 0, unread_count: 0 })),
  http.get('/api/vendor/v1/context', () => HttpResponse.json({ enabled: false, capabilities: [] })),
  ...apiHandlers,
]

/** The same requests for a user whose vendor context grants the Nasq administration module. */
export const vendorShellHandlers = [
  http.get('/api/vendor/v1/context', () => HttpResponse.json({ enabled: true, capabilities: ['vendor.read'] })),
  ...shellHandlers,
]
