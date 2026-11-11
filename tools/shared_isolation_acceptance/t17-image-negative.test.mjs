import test from 'node:test'
import assert from 'node:assert/strict'
import { requestPlan, sessionCodec } from '../../deploy/shared/guard.mjs'
const tenant = { host: 't17.acceptance.test', tenantId: 't17', database: 'synthetic_t17', filestore: 'synthetic_t17', enabled: true, registryRevision: 1 }
const codec = sessionCodec({ test: 'synthetic-key'.repeat(4) }, 'test')
const plan = (url, method = 'GET') => requestPlan({ url, method, headers: { host: tenant.host } }, { targets: [tenant] }, 'synthetic-token'.repeat(4), codec)
test('specific images allow positive HEAD while arbitrary models fields aliases and selectors deny', () => {
  for (const url of ['/web/image/hr.employee/1/avatar_128', '/web/image/res.company/1/logo/32x32?v=0-e3b0c44298fc']) {
    assert.equal(plan(url).headers.host, tenant.database); assert.equal(plan(url, 'HEAD').odoo, true)
    assert.throws(() => plan(url, 'POST')); assert.throws(() => plan(url + (url.includes('?') ? '&' : '?') + 'db=other'))
  }
  for (const url of ['/web/image/res.users/1/avatar_128', '/web/image/hr.employee/1/private', '/web/image/hr.employee/1/avatar_128?access_token=x', '/web/image/res.company/1/logo/128x128?v=0-e3b0c44298fc', '/web/image/hr.employee/2/../1/avatar_128', '/web/image/hr.employee/1/%61vatar_128']) assert.throws(() => plan(url))
})
