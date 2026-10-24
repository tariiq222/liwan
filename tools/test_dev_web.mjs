import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDevLaunch } from './dev_web.mjs'

const profile = {
  NUXT_PORT: '3117',
  ODOO_HTTP_PORT: '8217',
  NUXT_ODOO_URL: 'http://127.0.0.1:8217',
  NUXT_ODOO_DB: 'webvue_scratch_example',
  NUXT_PUBLIC_WS_URL: 'ws://localhost:8217/websocket',
}

function checkout(t, { worktree = true, dependencies = true, values = profile } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webvue-dev-entry-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'apps/web'), { recursive: true })
  if (worktree) writeFileSync(join(root, '.git'), 'gitdir: /unused/worktrees/example\n')
  else mkdirSync(join(root, '.git'))
  if (values) writeFileSync(join(root, '.env.worktree'), Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'))
  if (dependencies) {
    mkdirSync(join(root, 'node_modules/@nuxt/cli/bin'), { recursive: true })
    mkdirSync(join(root, 'node_modules/nuxt'), { recursive: true })
    writeFileSync(join(root, 'node_modules/@nuxt/cli/bin/nuxi.mjs'), '')
    writeFileSync(join(root, 'node_modules/nuxt/package.json'), '{"name":"nuxt"}')
  }
  return root
}

test('worktree launch selects its own profile and dependencies over unrelated inherited topology', t => {
  const root = checkout(t)
  const inherited = { NUXT_PORT: '3000', NITRO_PORT: '3000', PORT: '3000', NUXT_ODOO_URL: 'http://localhost:8069', NUXT_ODOO_DB: 'odoo19', NUXT_PUBLIC_WS_URL: 'ws://localhost:8069/websocket', WEBVUE_TENANCY_MODE: 'shared', PRIVATE_TOKEN: 'do-not-print' }
  const launch = createDevLaunch({ root, env: inherited })
  assert.equal(launch.cwd, join(root, 'apps/web'))
  assert.deepEqual(launch.args, [join(root, 'node_modules/@nuxt/cli/bin/nuxi.mjs'), 'dev', '--dotenv', join(root, '.env.worktree'), '--port', '3117', '--strictPort', '--no-takeover'])
  for (const [key, value] of Object.entries(profile)) assert.equal(launch.env[key], value)
  assert.equal(launch.env.WEBVUE_TENANCY_MODE, 'dedicated')
  assert.equal(launch.env.PRIVATE_TOKEN, 'do-not-print')
  assert.equal(inherited.NUXT_ODOO_DB, 'odoo19')
})

test('worktree without a profile never falls through to app .env or the daily stack', t => {
  const root = checkout(t, { values: null })
  writeFileSync(join(root, 'apps/web/.env'), 'NUXT_ODOO_DB=odoo19\n')
  assert.throws(() => createDevLaunch({ root, env: {} }), /\.env\.worktree/)
})

test('missing own dependencies never resolves Nuxt from an ancestor checkout', t => {
  const ancestor = checkout(t, { worktree: false })
  const root = join(ancestor, '.worktrees/missing')
  mkdirSync(join(root, 'apps/web'), { recursive: true })
  writeFileSync(join(root, '.git'), 'gitdir: unused\n')
  assert.throws(() => createDevLaunch({ root, env: {} }), /independent.*node_modules/)
})

test('linked dependency or generated directories cannot cross checkout boundaries', t => {
  const other = checkout(t)
  for (const target of ['node_modules', 'apps/web/node_modules', 'apps/web/.nuxt']) {
    const root = checkout(t)
    rmSync(join(root, target), { recursive: true, force: true })
    symlinkSync(join(other, 'node_modules'), join(root, target), 'dir')
    assert.throws(() => createDevLaunch({ root, env: {} }), /independent|checkout/)
  }
})

test('a linked CLI or Nuxt package cannot resolve to another checkout', t => {
  const other = checkout(t)
  for (const target of ['node_modules/@nuxt/cli/bin/nuxi.mjs', 'node_modules/nuxt']) {
    const root = checkout(t)
    rmSync(join(root, target), { recursive: true, force: true })
    symlinkSync(join(other, target), join(root, target))
    assert.throws(() => createDevLaunch({ root, env: {} }), /checkout/)
  }
})

test('main keeps Nuxt app .env discovery and explicit CLI options intact', t => {
  const root = checkout(t, { worktree: false })
  writeFileSync(join(root, 'apps/web/.env'), 'PRIVATE_TOKEN=private-value\n')
  const env = { NUXT_PORT: '3000', NUXT_ODOO_DB: 'odoo19' }
  const launch = createDevLaunch({ root, env, args: ['--port', '3333'] })
  assert.deepEqual(launch.env, env)
  assert.deepEqual(launch.args, [join(root, 'node_modules/@nuxt/cli/bin/nuxi.mjs'), 'dev', '--port', '3333'])
  assert.equal(launch.env.PRIVATE_TOKEN, undefined)
})

test('worktree rejects incomplete or daily-stack profile values without echoing values', t => {
  for (const patch of [
    { NUXT_PORT: '' }, { NUXT_PORT: '3000' }, { NUXT_PORT: '8069' }, { NUXT_PORT: 'NaN' },
    { NUXT_ODOO_DB: 'odoo19' }, { NUXT_ODOO_DB: '' },
    { NUXT_ODOO_URL: 'http://127.0.0.1:8069' }, { NUXT_ODOO_URL: 'file:///private-value' },
    { NUXT_PUBLIC_WS_URL: 'ws://localhost:8069/websocket' }, { NUXT_PUBLIC_WS_URL: '' },
    { NUXT_PUBLIC_WS_URL: 'ws://localhost:8218/websocket' }, { NUXT_PORT: '8217' },
  ]) {
    const root = checkout(t, { values: { ...profile, ...patch } })
    assert.throws(() => createDevLaunch({ root, env: {} }), error => !error.message.includes('private-value'))
  }
})

test('worktree CLI options cannot override its selected profile or project', t => {
  const root = checkout(t)
  for (const args of [['--port', '3000'], ['-p3000'], ['--dotenv', '/private-value'], ['../other-app']]) {
    assert.throws(() => createDevLaunch({ root, env: {}, args }), /\.env\.worktree/)
  }
})

test('dry-run selects the script checkout from any cwd without starting Nuxt or printing secrets', t => {
  const root = checkout(t, { values: { ...profile, PRIVATE_TOKEN: 'private-fixture-token' } })
  mkdirSync(join(root, 'tools'))
  copyFileSync(new URL('./dev_web.mjs', import.meta.url), join(root, 'tools/dev_web.mjs'))
  writeFileSync(join(root, 'node_modules/@nuxt/cli/bin/nuxi.mjs'), 'throw new Error("Nuxt must not start during dry-run")')
  const output = execFileSync(process.execPath, [join(root, 'tools/dev_web.mjs'), '--dry-run'], { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, PRIVATE_TOKEN: 'inherited-private-token' } })
  assert.match(output, /valid \(worktree\); no server started/)
  assert.doesNotMatch(output, /private-fixture-token|inherited-private-token/)
  const npmDryRun = execFileSync(process.execPath, [join(root, 'tools/dev_web.mjs')], { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, npm_config_dry_run: 'true' } })
  assert.match(npmDryRun, /no server started/)
})

test('terminating the launcher forwards SIGTERM to its own child and waits for cleanup', async t => {
  const root = checkout(t)
  mkdirSync(join(root, 'tools'))
  copyFileSync(new URL('./dev_web.mjs', import.meta.url), join(root, 'tools/dev_web.mjs'))
  writeFileSync(join(root, 'node_modules/@nuxt/cli/bin/nuxi.mjs'), `
    process.on('SIGTERM', () => { console.log('child-stopped'); process.exit(0) })
    console.log('child-ready:' + process.pid)
    setInterval(() => {}, 1000)
  `)
  const launcher = spawn(process.execPath, [join(root, 'tools/dev_web.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, npm_config_dry_run: 'false' } })
  let childPid
  t.after(() => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    if (childPid) { try { process.kill(childPid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
  })
  let output = ''
  launcher.stdout.on('data', chunk => { output += chunk })
  const exited = once(launcher, 'exit', { signal: AbortSignal.timeout(3000) })
  await once(launcher.stdout, 'data', { signal: AbortSignal.timeout(3000) })
  childPid = Number(output.match(/child-ready:(\d+)/)?.[1])
  assert.ok(childPid)
  launcher.kill('SIGTERM')
  assert.deepEqual(await exited, [0, null])
  assert.match(output, /child-stopped/)
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' })
})
