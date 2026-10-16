import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertSameOrigin } from '../origin'
import { bffHandler } from '../errors'
import { ORIGIN, send, stubConfig } from './harness'

const guarded = bffHandler('origin-test', (event) => { assertSameOrigin(event); return { ok: true } })

describe('assertSameOrigin', () => {
  beforeEach(() => stubConfig())
  afterEach(() => vi.unstubAllGlobals())

  it('lets a same-origin JSON POST through', async () => {
    expect((await send(guarded, '/x', { body: {} })).status).toBe(200)
  })

  it('does not check a GET', async () => {
    expect((await send(guarded, '/x', { method: 'GET' })).status).toBe(200)
  })

  it('requires a JSON content type', async () => {
    const result = await send(guarded, '/x', { body: {}, headers: { 'content-type': 'text/plain' } })
    expect(result).toMatchObject({ status: 415, body: { code: 'unsupported_media_type' } })
  })

  it('rejects a cross-site fetch metadata value', async () => {
    for (const site of ['cross-site', 'same-site']) {
      expect(await send(guarded, '/x', { body: {}, headers: { 'sec-fetch-site': site } })).toMatchObject({ status: 403, body: { code: 'cross_site_request' } })
    }
  })

  it('accepts the none fetch-site value (typed navigation tooling) only with the right Origin', async () => {
    expect((await send(guarded, '/x', { body: {}, headers: { 'sec-fetch-site': 'none' } })).status).toBe(200)
  })

  it('requires Origin to equal the admin origin', async () => {
    for (const origin of ['https://evil.example', `${ORIGIN}.evil.example`, '']) {
      expect(await send(guarded, '/x', { body: {}, headers: { origin } }), origin).toMatchObject({ status: 403, body: { code: 'cross_site_request' } })
    }
  })

  it('answers 503 when the admin origin is not configured', async () => {
    stubConfig({ adminOrigin: '' })
    expect(await send(guarded, '/x', { body: {} })).toMatchObject({ status: 503, body: { code: 'vendor_unavailable' } })
  })
})
