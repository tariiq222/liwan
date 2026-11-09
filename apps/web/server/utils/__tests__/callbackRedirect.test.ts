import { describe, expect, it } from 'vitest'
import { CALLBACK_REDIRECT_PATHS, CALLBACK_REDIRECT_PREFIX, isCallbackRedirect } from '../tenantTransport'

const CALLBACK = '/api/v1/inbox/tiktok/callback'

describe('isCallbackRedirect', () => {
  it('names only the provider OAuth callback as passable', () => {
    expect([...CALLBACK_REDIRECT_PATHS]).toEqual([CALLBACK])
    expect(CALLBACK_REDIRECT_PREFIX).toBe('/settings/apps/inbox')
  })

  it('passes the in-app redirect the callback answers with', () => {
    for (const location of ([
      '/settings/apps/inbox/channels/12',
      '/settings/apps/inbox?tiktok_error=inbox_tiktok_account_taken',
      '/settings/apps/inbox/channels/12?tab=messages',
    ])) expect(isCallbackRedirect(CALLBACK, 302, location), location).toBe(true)
  })

  it('ignores the query string of the request path', () => {
    expect(isCallbackRedirect(`${CALLBACK}?code=c&state=s`, 303, '/settings/apps/inbox/channels/1')).toBe(true)
  })

  it('refuses another status, another path or another route', () => {
    expect(isCallbackRedirect(CALLBACK, 200, '/settings/apps/inbox/channels/1')).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 307, '/settings/apps/inbox/channels/1')).toBe(false)
    expect(isCallbackRedirect('/api/v1/redirect', 302, '/settings/apps/inbox/channels/1')).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, '/api/v1/escaped')).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, '/crm/opportunities')).toBe(false)
  })

  it('refuses a redirect that leaves this app', () => {
    for (const location of ([
      'https://evil.example/settings/apps/inbox/channels/1',
      '//evil.example/settings/apps/inbox',
      'http://evil.example',
      '/settings/apps/inbox/../..//evil.example',
      '/settings/apps/inbox\\evil',
      '',
    ])) expect(isCallbackRedirect(CALLBACK, 302, location), location).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, null)).toBe(false)
  })

  it('refuses a prefix that is not a path boundary', () => {
    expect(isCallbackRedirect(CALLBACK, 302, '/settings/apps/inboxevil/channels/1')).toBe(false)
  })

  it('normalizes `..` and duplicate slashes before deciding, so they cannot walk out of the settings pages', () => {
    expect(isCallbackRedirect(CALLBACK, 302, '/settings/apps/inbox/../..//evil.example')).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, '/settings/apps/inbox/../crm')).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, '/settings/apps/inbox//channels/3')).toBe(true)
  })
})
