import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { createApp } from '../http.js'
import { PUBLIC_CONTACT_PATH } from '../public-site/http.js'

const service = { issuer: 'contact-wiring-web', key: 'contact-wiring-service-key-'.repeat(2) }
const config = { installationId: 'contact-wiring-cp', key: 'contact-wiring-installation-key-'.repeat(2), customerCommercialIssuer: service.issuer, customerCommercialServiceKey: service.key,
  contactNotifyEmail: 'owner@liwanos.com', inventoryPath: '/unused', stateDir: '/unused', repositoryRoot: '/unused', python: 'python3', tenantRegistryPath: '/unused/registry.json' }
const client = { release() {}, async query(sql: string) { return sql.startsWith('INSERT INTO service_nonces') ? { rows: [{ nonce: 'fresh' }], rowCount: 1 } : { rows: [], rowCount: 0 } } }
const pool = { connect: async () => client } as unknown as Pool
const address = '192.0.2.10'
const body = JSON.stringify({ name: 'Sara', email: 'sara@acme.com.sa', company: 'Acme', mobile: '+966555000111', message: 'We want a demo', lang: 'ar', consent: true })
const contact = (origin: string) => fetch(origin + PUBLIC_CONTACT_PATH, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-liwan-client-ip': address,
  ...signServiceRequest({ method: 'POST', path: PUBLIC_CONTACT_PATH, body: `liwan-public-contact:${address}\n${body}`, actor: 'anonymous', anonymous: true, ...service }) } })

async function withApp(run: (origin: string) => Promise<void>) {
  const server = createApp(pool, config)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const bound = server.address(); if (!bound || typeof bound === 'string') throw Error('missing address')
  try { await run(`http://127.0.0.1:${bound.port}`) } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}

beforeAll(() => { vi.stubEnv('LIWAN_PUBLIC_SIGNUP', 'false') })
afterAll(() => { vi.unstubAllEnvs() })

it('opens the contact form with the Turnstile keys while public sign-up is closed', async () => {
  vi.stubEnv('LIWAN_SIGNUP_TURNSTILE_SITE_KEY', 'site-key-12345678')
  vi.stubEnv('LIWAN_SIGNUP_TURNSTILE_SECRET_KEY', 'secret-key-12345678')
  await withApp(async origin => {
    const answer = await contact(origin)
    expect(answer.status).toBe(422)
    expect((await answer.json()).code).toBe('turnstile_required')
  })
})
it('fails closed with 503 when the Turnstile keys are missing', async () => {
  vi.stubEnv('LIWAN_SIGNUP_TURNSTILE_SITE_KEY', '')
  vi.stubEnv('LIWAN_SIGNUP_TURNSTILE_SECRET_KEY', '')
  await withApp(async origin => { expect((await contact(origin)).status).toBe(503) })
})
