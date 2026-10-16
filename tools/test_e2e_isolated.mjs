import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:net'
import { PREFERRED, SCRATCH_DB, assertScratchDb, e2eCommand, forwardArgs, freePort, odooArgs, odooConf, parsePort, pgSettings, pickPorts, refusalReason, stackName } from './e2e_isolated.mjs'

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

test('E2E_COMMAND selects run or explore', () => {
  assert.equal(e2eCommand({}), 'run')
  assert.equal(e2eCommand({ E2E_COMMAND: 'explore' }), 'explore')
  assert.throws(() => e2eCommand({ E2E_COMMAND: 'list' }), /E2E_COMMAND/)
  assert.deepEqual(forwardArgs(['goal'], 'explore'), ['e2e', 'explore', 'goal'])
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
  assert.deepEqual(await pickPorts({}, async () => 1, yes), { mock: PREFERRED.mock, nuxt: PREFERRED.nuxt })
  let n = 4600
  const no = async () => false
  assert.deepEqual(await pickPorts({}, async () => n++, no), { mock: 4600, nuxt: 4601 })
  await assert.rejects(pickPorts({ E2E_MOCK_PORT: '4501', E2E_NUXT_PORT: '4501' }))
})

test('pickPorts for the odoo stack picks odoo and nuxt only', async () => {
  const yes = async () => true
  assert.deepEqual(await pickPorts({}, async () => 1, yes, 'odoo'), { odoo: PREFERRED.odoo, nuxt: PREFERRED.nuxt })
  assert.deepEqual(await pickPorts({ E2E_ODOO_PORT: '4701' }, async () => 1, yes, 'odoo'), { odoo: 4701, nuxt: PREFERRED.nuxt })
  assert.throws(() => parsePort('8069', 'E2E_ODOO_PORT'))
  await assert.rejects(pickPorts({ E2E_ODOO_PORT: '4701', E2E_NUXT_PORT: '4701' }, freePort, yes, 'odoo'))
})

test('the database guard only accepts webvue_scratch_e2e', () => {
  assert.equal(assertScratchDb(SCRATCH_DB), 'webvue_scratch_e2e')
  for (const bad of ['odoo19', 'webvue_scratch_e2e2', 'webvue_scratch', '', undefined, 'postgres']) {
    assert.throws(() => assertScratchDb(bad), /refusing database/)
  }
  assert.throws(() => odooArgs('serve', { conf: '/c', db: 'odoo19' }), /refusing database/)
  assert.throws(() => odooConf({ db: 'odoo19', port: 43369, addonsPath: [], dataDir: '/d', logFile: '/l', pg: pgSettings({}) }), /refusing database/)
})

test('odoo args are built per command kind', () => {
  const base = { conf: '/c.conf', db: SCRATCH_DB, modules: 'a,b' }
  assert.deepEqual(odooArgs('install', base), ['-c', '/c.conf', '-d', SCRATCH_DB, '-i', 'a,b', '--without-demo=all', '--stop-after-init'])
  assert.deepEqual(odooArgs('update', base), ['-c', '/c.conf', '-d', SCRATCH_DB, '-u', 'a,b', '--no-http', '--stop-after-init'])
  assert.deepEqual(odooArgs('shell', base), ['shell', '-c', '/c.conf', '-d', SCRATCH_DB, '--no-http'])
  assert.deepEqual(odooArgs('serve', base), ['-c', '/c.conf', '-d', SCRATCH_DB])
  assert.throws(() => odooArgs('drop', base))
})

test('odoo conf is scratch-only and carries no password', () => {
  const conf = odooConf({ db: SCRATCH_DB, port: 43369, addonsPath: ['/o/a', '/r/odoo-addons'], dataDir: '/d', logFile: '/l', pg: pgSettings({}) })
  assert.match(conf, /^dbfilter = \^webvue_scratch_e2e\$$/m)
  assert.match(conf, /^http_port = 43369$/m)
  assert.match(conf, /^addons_path = \/o\/a,\/r\/odoo-addons$/m)
  assert.match(conf, /^workers = 0$/m)
  assert.doesNotMatch(conf, /password/i)
  assert.deepEqual(pgSettings({}), { host: '127.0.0.1', port: '5432', user: 'tariq' })
  assert.equal(pgSettings({ PGHOST: 'h', PGPORT: '1', PGUSER: 'u' }).user, 'u')
})

test('stackName defaults to mock and rejects unknown stacks', () => {
  assert.equal(stackName({}), 'mock')
  assert.equal(stackName({ E2E_STACK: 'odoo' }), 'odoo')
  assert.throws(() => stackName({ E2E_STACK: 'prod' }))
})
