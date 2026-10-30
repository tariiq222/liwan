import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
const library = await import('./lib.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
  return {}
})

test('unsafe or duplicate published ports are refused before provisioning', () => {
  assert.equal(typeof library.validatePorts, 'function')
  for (const ports of [[80, 45002, 45003, 45004], [45001, 45001, 45003, 45004], [3000, 45002, 45003, 45004], [8069, 45002, 45003, 45004], [45001, 5432, 45003, 45004], [45001, 45002, 65536, 45004]]) assert.throws(() => library.validatePorts(ports))
  assert.doesNotThrow(() => library.validatePorts([45001, 45002, 45003, 45004]))
})

test('results require independent tenant resources and exact own identities', () => {
  assert.equal(typeof library.assertTenantIdentity, 'function')
  const a = { id: 'a', host: 'a.foundation.liwan.test', database: 'liwan_scratch_a', filestore: 'liwan_scratch_a', name: 'A', adminLogin: 'a@example.test' }
  const b = { id: 'b', host: 'b.foundation.liwan.test', database: 'liwan_scratch_b', filestore: 'liwan_scratch_b', name: 'B', adminLogin: 'b@example.test' }
  assert.doesNotThrow(() => library.assertTenantIdentity([a, b], [{ login: 'a@example.test', company: { name: 'A' } }, { login: 'b@example.test', company: { name: 'B' } }]))
  assert.throws(() => library.assertTenantIdentity([a, { ...b, filestore: a.filestore }], [{}, {}]))
  assert.throws(() => library.assertTenantIdentity([a, b], [{ login: 'b@example.test', company: { name: 'A' } }, {}]))
})

test('cross-cookie denial must carry boundary error and real HTTP 403', () => {
  assert.equal(typeof library.isBoundaryDenial, 'function')
  assert.equal(library.isBoundaryDenial({ status: 403, text: '{"code":"tenant_boundary_rejected"}' }), true)
  for (const response of [{ status: 500, text: 'tenant_boundary_rejected' }, { status: 403, text: '{"code":"forbidden"}' }, { status: 200, text: 'tenant_boundary_rejected' }]) assert.equal(library.isBoundaryDenial(response), false)
})

test('stop retains volumes, containers and private diagnostics even on failure', async () => {
  assert.equal(typeof library.stopRetainingData, 'function')
  const commands = []
  const result = await library.stopRetainingData(args => { commands.push(args); return { ok: true } })
  assert.deepEqual(commands, [['logs', '--no-color', '--tail', '500'], ['stop', '--timeout', '20']])
  assert.equal(result.ok, true)
})

test('private evidence is saved without replacing existing files', () => {
  assert.equal(typeof library.writePrivate, 'function')
  const directory = mkdtempSync(join(tmpdir(), 'liwan-foundation-test-'))
  const file = join(directory, 'evidence.json')
  library.writePrivate(file, '{"passed":false}')
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.throws(() => library.writePrivate(file, 'overwrite'))
  assert.equal(readFileSync(file, 'utf8'), '{"passed":false}')
})

test('cookie replay uses the last cookie of each name', () => {
  assert.equal(typeof library.cookieHeader, 'function')
  assert.equal(library.cookieHeader(['session_id=first; Secure', 'language=ar', 'session_id=last; Secure']), 'session_id=last; language=ar')
})

test('TLS edge client validates trust and sends a tenant Host without the high port', async t => {
  const { execFileSync } = await import('node:child_process')
  const https = await import('node:https')
  const directory = mkdtempSync(join(tmpdir(), 'liwan-foundation-tls-'))
  const key = join(directory, 'key.pem')
  const cert = join(directory, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=a.foundation.liwan.test', '-addext', 'subjectAltName=DNS:a.foundation.liwan.test'], { stdio: 'ignore' })
  const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
    response.writeHead(200, { 'set-cookie': ['session_id=one; Secure', 'session_id=two; Secure'] })
    response.end(JSON.stringify({ host: request.headers.host, sni: request.socket.servername }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const port = server.address().port
  const result = await library.edgeRequest('a.foundation.liwan.test', '/api/v1/me', { port, ca: readFileSync(cert) })
  assert.equal(result.status, 200)
  assert.deepEqual(JSON.parse(result.text), { host: 'a.foundation.liwan.test', sni: 'a.foundation.liwan.test' })
  await assert.rejects(library.edgeRequest('a.foundation.liwan.test', '/', { port }))
  await assert.rejects(library.edgeRequest('wrong.foundation.liwan.test', '/', { port, ca: readFileSync(cert) }))
})

test('invalid invocation cannot touch Docker or start a stack', async () => {
  const { spawnSync } = await import('node:child_process')
  const invocation = spawnSync(process.execPath, ['tools/foundation_acceptance/provision_two_tenants.mjs', '--down'], { cwd: new URL('../..', import.meta.url), env: { PATH: '/nonexistent' }, encoding: 'utf8' })
  assert.equal(invocation.status, 1)
  assert.match(invocation.stderr, /usage: LIWAN_IMAGE_TAG/)
})
