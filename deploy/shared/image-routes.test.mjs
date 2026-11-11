import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestPlan, sessionCodec } from './guard.mjs'
const target = { host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 1 }
const token = 'synthetic-key'.repeat(4)
const codec = sessionCodec({ key: token }, 'key')
const plan = (url, method = 'GET') => requestPlan({ url, method, headers: { host: target.host } }, { targets: [target] }, token, codec)
const favicon = '/web/image/res.company/7/logo/32x32?v=20260924123456123456-abcdef123456'
const avatar = '/web/image/hr.employee/9/avatar_128'
test('actual favicon and EmployeeCard shapes route only to registry database', () => {
  for (const method of ['GET', 'HEAD']) for (const path of [favicon, avatar]) assert.equal(plan(path, method).headers.host, 'db_a')
})
test('image allowlist refuses generic routes, overrides, duplicate queries and traversal aliases', () => {
  for (const path of [favicon + '&v=0-abcdef123456', favicon + '&access_token=x', avatar + '?access_token=x', avatar + '?id=2', avatar + '?db=db_b', avatar + '?model=res.users', avatar + '?field=image_1920', avatar + '?v=1', favicon.replace('/7/', '/0/'), favicon.replace('/7/', '/-1/'), favicon.replace('/logo/', '/image_1920/'), avatar.replace('hr.employee', 'res.users'), avatar + '/32x32', '/web/image', '/web/image/ir.attachment/1/raw', '/web/image/res.company/8/../7/logo/32x32?v=0-abcdef123456', '/web/image/res.company/%37/logo/32x32?v=0-abcdef123456', favicon + '#fragment']) assert.throws(() => plan(path), path)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) for (const path of [favicon, avatar]) assert.throws(() => plan(path, method))
})
