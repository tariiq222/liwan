import { describe, expect, it } from 'vitest'
import { CALLBACK_REDIRECT_PREFIXES, isCallbackRedirect } from '../tenantTransport'

const CALLBACK = '/api/v1/integrations/oauth/tiktok/callback'
const PAGE = '/settings/integrations'

describe('isCallbackRedirect', () => {
  it('names only the integrations page as a place the callback may send the browser', () => {
    expect(CALLBACK_REDIRECT_PREFIXES).toEqual([PAGE])
  })

  it('passes the integrations OAuth callback of any provider back to the integrations page', () => {
    expect(isCallbackRedirect(CALLBACK, 302, `${PAGE}?provider=tiktok&result=connected`)).toBe(true)
    expect(isCallbackRedirect(`${CALLBACK}?code=c&state=s`, 303, `${PAGE}?provider=tiktok&error=denied`)).toBe(true)
    expect(isCallbackRedirect('/api/v1/integrations/oauth/other/callback', 302, `${PAGE}?provider=other&result=connected`)).toBe(true)
    expect(isCallbackRedirect(CALLBACK, 302, '/settings/integrationsevil')).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, '/crm')).toBe(false)
    expect(isCallbackRedirect('/api/v1/integrations/oauth/tiktok/start', 302, PAGE)).toBe(false)
    expect(isCallbackRedirect('/api/v1/integrations/oauth/Tik/callback', 302, PAGE)).toBe(false)
  })

  it('no longer passes the removed inbox TikTok callback', () => {
    expect(isCallbackRedirect('/api/v1/inbox/tiktok/callback', 302, '/settings/apps/inbox/channels/12')).toBe(false)
  })

  it('ignores the query string of the request path', () => {
    expect(isCallbackRedirect(`${CALLBACK}?code=c&state=s`, 303, `${PAGE}?result=connected`)).toBe(true)
  })

  it('refuses another status, another path or another route', () => {
    expect(isCallbackRedirect(CALLBACK, 200, PAGE)).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 307, PAGE)).toBe(false)
    expect(isCallbackRedirect('/api/v1/redirect', 302, PAGE)).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, '/api/v1/escaped')).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, '/crm/opportunities')).toBe(false)
  })

  it('refuses a redirect that leaves this app', () => {
    for (const location of ([
      `https://evil.example${PAGE}`,
      '//evil.example/settings/integrations',
      'http://evil.example',
      '/settings/integrations/../..//evil.example',
      '/settings/integrations\\evil',
      '',
    ])) expect(isCallbackRedirect(CALLBACK, 302, location), location).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, null)).toBe(false)
  })

  it('normalizes `..` and duplicate slashes before deciding, so they cannot walk out of the integrations page', () => {
    expect(isCallbackRedirect(CALLBACK, 302, '/settings/integrations/../..//evil.example')).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, '/settings/integrations/../crm')).toBe(false)
    expect(isCallbackRedirect(CALLBACK, 302, '/settings/integrations//connections/3')).toBe(true)
  })
})
