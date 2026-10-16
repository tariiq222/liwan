import { http, HttpResponse } from 'msw'
import { apiHandlers } from './api'
import { shellBranding, shellMe } from '../fixtures/shell'

/** The shell's own requests: identity, branding, and the bell. First match wins. */
export const shellHandlers = [
  http.get('/api/v1/me', () => HttpResponse.json(shellMe)),
  http.get('/api/v1/branding', () => HttpResponse.json(shellBranding)),
  http.get('/api/v1/notifications', () => HttpResponse.json({ items: [], total: 0, unread_count: 0 })),
  ...apiHandlers,
]
