import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestPlan, sessionCodec } from './guard.mjs'

const tenant = { host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 1 }
const registry = { targets: [tenant] }
const token = 'synthetic-private-token'.repeat(3)
const codec = sessionCodec({ test: token }, 'test')
const session = '/web/session'

// Independent security-review observations, not expectations derived from guard.
// A thrown requestPlan error is mapped to HTTP 403 by createGuard.
const variants = [
  [`${session}/get_session_info`, 'forbidden_route'],
  [`${session}/get_session_info/`, 'forbidden_route'],
  [`${session}/get_session_info/../authenticate`, 'forbidden_route'],
  ['//web/session/get_session_info', 'invalid_path'],
  ['/web%2Fsession%2Fget_session_info', 'nuxt'],
  [`${session}/%67et_session_info`, 'forbidden_route'],
  [`${session}/Get_Session_Info`, 'forbidden_route'],
  ['/WEB/session/get_session_info', 'nuxt'],
  [`${session}/get_session_info;x=1`, 'forbidden_route'],
  [`${session}/get_session_info?db=x`, 'forbidden_selector'],
  [`${session}/x/../get_session_info`, 'forbidden_route'],
  ['/web/image/../../web/session/authenticate', 'forbidden_route'],
  ['/web/binary/company_logo/../session/authenticate', 'forbidden_route'],
  [`${session}/authenticate`, 'forbidden_route'],
  ['/api/auth/login', 'nuxt'],
]

for (const [url, outcome] of variants) {
  test(`browser rate-limit variant ${url}: ${outcome === 'nuxt' ? 'Nuxt only' : `403 ${outcome}`}`, () => {
    // Keep the raw URL: constructing a URL here would pre-normalize traversals.
    // Neither anonymous nor signed browser sessions may gain internal authority.
    for (const cookie of ['', `session_id=${codec.seal('browser_sid', tenant)}`]) {
      for (const method of ['GET', 'POST']) {
        let plan
        let error
        try {
          plan = requestPlan({ url, method, headers: { host: tenant.host, cookie } }, registry, token, codec)
        } catch (caught) {
          error = caught
        }
        assert.ok(!(plan?.odoo && plan.path.split('?')[0] === `${session}/authenticate`), 'browser must never reach Odoo credential handler')
        if (outcome === 'nuxt') {
          assert.equal(error, undefined)
          assert.equal(plan.internal, false)
          assert.equal(plan.odoo, false)
          assert.equal(plan.headers.host, tenant.host)
          assert.equal(plan.path, url)
        } else {
          assert.equal(plan, undefined)
          assert.ok(error instanceof Error)
          assert.equal(error.message, outcome)
        }
      }
    }
  })
}
