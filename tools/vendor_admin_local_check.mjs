#!/usr/bin/env node
// Live local proof of the vendor admin sign-in against the REAL control plane.
//
//   node tools/vendor_admin_local_check.mjs
//
// Creates the scratch database nasq_control_scratch_p3live, starts the control plane (127.0.0.1:4711), bootstraps
// the first owner, builds and starts apps/vendor-admin (production build, port 3103) and runs the Playwright live
// spec (apps/vendor-admin/e2e/live-control.spec.ts, config playwright.live.config.ts). Prints a pass/fail table
// and tears everything down in a finally block. Keys are generated per run and never printed; not part of CI.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_APP = join(ROOT, 'apps', 'vendor-admin')
const DB_NAME = 'nasq_control_scratch_p3live'
const PG = { host: '127.0.0.1', port: '5432' }
const CONTROL_PORT = 4711
const ADMIN_PORT = 3103
const ADMIN_ORIGIN = `http://localhost:${ADMIN_PORT}`
const INSTALLATION_ID = 'vendor-live'
const SHOTS_DIR = join(ROOT, '.superpowers', 'wave4-live-shots')

if (!DB_NAME.startsWith('nasq_control_scratch_')) throw new Error('refusing to run: the database must be a nasq_control_scratch_* database')

const rows = []
const record = (name, ok, detail = '') => { rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }
const children = []
let workDir
let databaseCreated = false

const psql = (database, sql) => spawnSync('psql', ['-h', PG.host, '-p', PG.port, '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { encoding: 'utf8' })
const portBusy = port => new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port })
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(check, what, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${what}`)
}

function start(name, command, args, options) {
  const child = spawn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let tail = ''
  const keep = (data) => { tail = (tail + data.toString()).slice(-4000) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  child.on('exit', (code) => { child.exited = code ?? 'signal' })
  children.push({ name, child })
  return { child, tail: () => tail }
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

async function stopAll() {
  for (const { child } of children.reverse()) {
    if (child.exited !== undefined || !child.pid) continue
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
  }
  await sleep(1500)
  for (const { child } of children) {
    if (child.exited !== undefined || !child.pid) continue
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
  }
}

function tableFromReport(path) {
  if (!existsSync(path)) return []
  const found = []
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const status = spec.tests?.[0]?.results?.at(-1)?.status ?? 'skipped'
      found.push({ name: spec.title, ok: status === 'passed', detail: status })
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of JSON.parse(readFileSync(path, 'utf8')).suites ?? []) walk(suite)
  return found
}

let exitCode = 1
try {
  for (const port of [CONTROL_PORT, ADMIN_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is already in use`)
  workDir = mkdtempSync(join(tmpdir(), 'vendor-admin-live-'))
  for (const dir of ['state', 'repo']) mkdirSync(join(workDir, dir))
  writeFileSync(join(workDir, 'inventory.json'), '{}\n')

  // Keys exist only in this process and in the child environments.
  const serviceKey = randomBytes(32).toString('hex')
  const adminSecret = randomBytes(32).toString('hex')
  const databaseUrl = `postgresql://${userInfo().username}@${PG.host}:${PG.port}/${DB_NAME}`

  const dropped = psql('postgres', `DROP DATABASE IF EXISTS ${DB_NAME}`)
  const created = dropped.status === 0 ? psql('postgres', `CREATE DATABASE ${DB_NAME}`) : dropped
  databaseCreated = created.status === 0
  record('scratch database created', databaseCreated, DB_NAME)
  if (!databaseCreated) throw new Error('could not create the scratch database')

  const controlEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER,
    CONTROL_DATABASE_URL: databaseUrl, CONTROL_INSTALLATION_ID: INSTALLATION_ID, CONTROL_SERVICE_KEY: serviceKey,
    CONTROL_HOST: '127.0.0.1', CONTROL_PORT: String(CONTROL_PORT),
    ADMIN_SECRET_KEY: adminSecret, ADMIN_RP_ID: 'localhost', ADMIN_ORIGIN: ADMIN_ORIGIN,
    NASQ_CLI_INVENTORY: join(workDir, 'inventory.json'), NASQ_CLI_STATE_DIR: join(workDir, 'state'), NASQ_REPOSITORY_ROOT: join(workDir, 'repo'),
  }
  const control = start('control plane', 'npm', ['-w', 'apps/control-plane', 'run', 'dev'], { cwd: ROOT, env: controlEnv })
  try {
    await waitFor(async () => { if (control.child.exited !== undefined) throw new Error('control plane exited'); return portBusy(CONTROL_PORT) }, 'the control plane')
    record('control plane listening', true, `127.0.0.1:${CONTROL_PORT}`)
  } catch (error) {
    record('control plane listening', false, control.tail().split('\n').slice(-3).join(' | '))
    throw error
  }

  const bootstrap = run('npm', ['-w', 'apps/control-plane', 'run', 'admin', '--silent', '--', 'bootstrap-owner', 'owner@example.test', 'Live Owner', 'live proof'], { cwd: ROOT, env: controlEnv })
  const link = bootstrap.stdout.trim().split('\n').at(-1) ?? ''
  const linkOk = bootstrap.ok && new RegExp(`^${ADMIN_ORIGIN.replace(/[.]/g, '\\.')}/enroll#[A-Za-z0-9_-]{43}$`).test(link)
  record('bootstrap-owner printed an enroll link', linkOk, linkOk ? 'link kept out of the output' : bootstrap.stderr.trim().slice(-200))
  if (!linkOk) throw new Error('bootstrap-owner failed')

  const prepared = run('npx', ['nuxt', 'prepare'], { cwd: ADMIN_APP })
  const built = prepared.ok && run('npx', ['nuxt', 'build'], { cwd: ADMIN_APP })
  record('vendor admin production build', Boolean(built && built.ok), built?.ok ? '' : (built?.stderr ?? prepared.stderr).trim().slice(-300))
  if (!built?.ok) throw new Error('vendor admin build failed')

  start('vendor admin', 'node', ['.output/server/index.mjs'], {
    cwd: ADMIN_APP,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(ADMIN_PORT),
      NUXT_CONTROL_URL: `http://127.0.0.1:${CONTROL_PORT}`, NUXT_SERVICE_KEY: serviceKey, NUXT_INSTALLATION_ID: INSTALLATION_ID,
      NUXT_ADMIN_ORIGIN: ADMIN_ORIGIN, NUXT_TRUST_PROXY: 'false',
    },
  })
  await waitFor(async () => { try { return (await fetch(`${ADMIN_ORIGIN}/login`)).ok } catch { return false } }, 'the vendor admin server', 60_000)
  record('vendor admin listening', true, ADMIN_ORIGIN)

  rmSync(SHOTS_DIR, { recursive: true, force: true })
  const reportPath = join(workDir, 'playwright-report.json')
  const playwright = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.live.config.ts'], {
    cwd: ADMIN_APP, stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      LIVE_ADMIN_ORIGIN: ADMIN_ORIGIN, LIVE_BOOTSTRAP_LINK: link, LIVE_DATABASE_URL: databaseUrl,
      LIVE_SHOTS_DIR: SHOTS_DIR, LIVE_JSON_REPORT: reportPath,
    },
  })
  const specRows = tableFromReport(reportPath)
  for (const row of specRows) record(row.name, row.ok, row.detail)
  record('live spec', playwright.status === 0 && specRows.length > 0 && specRows.every(row => row.ok), `${specRows.filter(row => row.ok).length}/${specRows.length} passed`)
} catch (error) {
  console.error(`live check stopped: ${error instanceof Error ? error.message : error}`)
} finally {
  await stopAll()
  if (databaseCreated) {
    const dropped = psql('postgres', `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)
    record('scratch database dropped', dropped.status === 0, DB_NAME)
  }
  if (workDir) rmSync(workDir, { recursive: true, force: true })
  const leftover = []
  for (const port of [CONTROL_PORT, ADMIN_PORT]) if (await portBusy(port)) leftover.push(port)
  record('ports released', leftover.length === 0, leftover.length ? leftover.join(',') : `${CONTROL_PORT}, ${ADMIN_PORT}`)

  const width = Math.max(...rows.map(row => row.name.length))
  console.log(`\n${'result'.padEnd(7)}${'check'.padEnd(width + 2)}detail`)
  for (const row of rows) console.log(`${(row.ok ? 'PASS' : 'FAIL').padEnd(7)}${row.name.padEnd(width + 2)}${row.detail}`)
  const failed = rows.filter(row => !row.ok).length
  console.log(`\n${rows.length - failed}/${rows.length} passed${failed ? `, ${failed} FAILED` : ''}`)
  exitCode = failed || !rows.some(row => row.name === 'live spec') ? 1 : 0
}
process.exit(exitCode)
