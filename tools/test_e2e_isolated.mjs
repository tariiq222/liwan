import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:net'
import { PREFERRED, forwardArgs, freePort, parsePort, pickPorts, refusalReason } from './e2e_isolated.mjs'

test('refuses the daily dev origins', () => {
  assert.match(refusalReason('http://localhost:3000'), /refusing/)
  assert.match(refusalReason('http://127.0.0.1:8069/x'), /refusing/)
  assert.match(refusalReason('nonsense'), /not a valid URL/)
})

test('accepts unset or other origins', () => {
  assert.equal(refusalReason(undefined), null)
  assert.equal(refusalReason(''), null)
  assert.equal(refusalReason('http://localhost:4123'), null)
})

test('forwards all CLI args to e2e run', () => {
  assert.deepEqual(forwardArgs([]), ['e2e', 'run'])
  assert.deepEqual(forwardArgs(['a.e2e.ts', '--headed']), ['e2e', 'run', 'a.e2e.ts', '--headed'])
})

test('parsePort validates', () => {
  assert.equal(parsePort(undefined, 'X'), null)
  assert.equal(parsePort('4555', 'X'), 4555)
  assert.throws(() => parsePort('3000', 'X'))
  assert.throws(() => parsePort('80', 'X'))
  assert.throws(() => parsePort('abc', 'X'))
})

test('freePort returns a bindable port', async () => {
  const port = await freePort()
  await new Promise((resolve, reject) => {
    const s = createServer().once('error', reject)
    s.listen(port, '127.0.0.1', () => s.close(resolve))
  })
})

test('pickPorts honours env and rejects equal ports', async () => {
  assert.deepEqual(await pickPorts({ E2E_MOCK_PORT: '4501', E2E_NUXT_PORT: '4502' }), { mock: 4501, nuxt: 4502 })
  const yes = async () => true
  assert.deepEqual(await pickPorts({}, async () => 1, yes), PREFERRED)
  let n = 4600
  const no = async () => false
  assert.deepEqual(await pickPorts({}, async () => n++, no), { mock: 4600, nuxt: 4601 })
  await assert.rejects(pickPorts({ E2E_MOCK_PORT: '4501', E2E_NUXT_PORT: '4501' }))
})
