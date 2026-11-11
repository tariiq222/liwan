import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestPlan, sessionCodec } from './guard.mjs'
const a = { host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 1 }
const b = { ...a, host: 'b.example.test', tenantId: 'b', database: 'db_b', filestore: 'db_b' }
const registry = { targets: [a, b] }
const token = 'synthetic-private-token'.repeat(3)
const codec = sessionCodec({ key: token }, 'key')
const plan = (url, headers = {}, extra = {}) => requestPlan({ url, method: 'GET', headers: { host: a.host, ...headers }, ...extra }, registry, token, codec)
const logo = '/web/binary/company_logo?company=1&v=0-abcdef123456'
test('logo narrowly allows GET/HEAD with anonymous/signed tenant binding, not generic binary', () => {
  for (const method of ['GET', 'HEAD']) for (const cookie of ['', `session_id=${codec.seal('sid', a)}`]) {
    assert.equal(plan(logo, { cookie }, { method }).headers.host, 'db_a')
  }
  // A foreign numeric company id remains inside db_a; it cannot select db_b.
  assert.equal(plan(logo.replace('company=1', 'company=999')).headers.host, 'db_a')
  assert.throws(() => plan(logo, { cookie: `session_id=${codec.seal('sid', b)}` }))
  for (const path of [logo + '&db=db_b', logo + '&company=2', logo + '&x=1', logo.replace('company=1', 'company=-1'), '/web/binary/other', logo + '&session_id=raw']) assert.throws(() => plan(path))
  assert.throws(() => plan(logo, {}, { method: 'POST' }))
})
test('browser WS exact HTTPS tenant Origin only; no missing or sibling exceptions', () => {
  const cookie = `session_id=${codec.seal('sid', a)}`
  assert.equal(plan('/websocket', { cookie, origin: 'https://a.example.test' }).headers.host, 'db_a')
  for (const origin of [undefined, 'null', 'https://b.example.test', 'http://a.example.test', 'https://a.example.test:443', 'https://a.example.test/', 'https://evil.test', 'https://a.example.test, https://a.example.test', ['https://a.example.test']]) assert.throws(() => plan('/websocket', { cookie, origin }))
  assert.throws(() => plan('/websocket', { cookie, origin: 'https://a.example.test' }, { rawHeaders: ['Origin', 'https://a.example.test', 'origin', 'https://a.example.test'] }))
})
