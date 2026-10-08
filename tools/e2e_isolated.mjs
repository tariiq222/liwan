#!/usr/bin/env node
// Run the agentic e2e runner against an isolated stack and a private Nuxt dev
// server on free ports. E2E_STACK=mock (default) uses the repo mock API;
// E2E_STACK=odoo uses a real scratch Odoo on the fixed database
// `nasq_scratch_e2e`. Never touches :3000, :8069 or the dev `odoo19` database.
// All CLI args are forwarded to `npx e2e run` (or `explore` with E2E_COMMAND=explore).
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = join(ROOT, 'apps', 'web')
const LOG_DIR = join(ROOT, '.e2e', 'logs')
const FORBIDDEN_PORTS = new Set(['3000', '8069'])
const MOCK_DB = 'nasq_ui_mock_only'
export const SCRATCH_DB = 'nasq_scratch_e2e'
const ODOO_ROOT = process.env.E2E_ODOO_ROOT || '/Users/tariq/code/odoo'
const ODOO_DIR = join(ROOT, '.e2e', 'odoo')

// Only the fixed scratch database may be created, dropped or served.
export function assertScratchDb(name) {
  if (name !== SCRATCH_DB) {
    throw new Error(`refusing database "${name}": the e2e Odoo stack only uses ${SCRATCH_DB}`)
  }
  return name
}

export function stackName(env = process.env) {
  const stack = env.E2E_STACK || 'mock'
  if (stack !== 'mock' && stack !== 'odoo') throw new Error(`E2E_STACK must be "mock" or "odoo", got "${stack}"`)
  return stack
}

export function pgSettings(env = process.env) {
  return { host: env.PGHOST || '127.0.0.1', port: env.PGPORT || '5432', user: env.PGUSER || 'tariq' }
}

// Scratch-only Odoo config. No password: PGPASSWORD comes from the environment.
export function odooConf({ db, port, addonsPath, dataDir, logFile, pg }) {
  assertScratchDb(db)
  return [
    '[options]',
    `addons_path = ${addonsPath.join(',')}`,
    `db_host = ${pg.host}`,
    `db_port = ${pg.port}`,
    `db_user = ${pg.user}`,
    `db_name = ${db}`,
    `dbfilter = ^${db}$`,
    `data_dir = ${dataDir}`,
    `logfile = ${logFile}`,
    `http_port = ${port}`,
    'http_interface = 127.0.0.1',
    'workers = 0',
    'max_cron_threads = 0',
    'list_db = False',
    '',
  ].join('\n')
}

export function odooArgs(kind, { conf, db, modules }) {
  assertScratchDb(db)
  if (kind === 'install') {
    return ['-c', conf, '-d', db, '-i', modules, '--without-demo=all', '--stop-after-init']
  }
  if (kind === 'update') return ['-c', conf, '-d', db, '-u', modules, '--no-http', '--stop-after-init']
  if (kind === 'shell') return ['shell', '-c', conf, '-d', db, '--no-http']
  if (kind === 'serve') return ['-c', conf, '-d', db]
  throw new Error(`unknown odoo command kind "${kind}"`)
}

export function refusalReason(baseUrl) {
  if (!baseUrl) return null
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    return `E2E_BASE_URL is not a valid URL: ${baseUrl}`
  }
  if (FORBIDDEN_PORTS.has(url.port)) {
    return `E2E_BASE_URL points at :${url.port}, the daily dev stack; refusing to run test traffic there. Unset it or use "npm run e2e:dev" deliberately.`
  }
  return null
}

// E2E_COMMAND selects the runner subcommand: `run` (default) or `explore`.
export function e2eCommand(env = process.env) {
  const command = env.E2E_COMMAND || 'run'
  if (command !== 'run' && command !== 'explore') throw new Error(`E2E_COMMAND must be "run" or "explore", got "${command}"`)
  return command
}

export function forwardArgs(argv, command = 'run') {
  return ['e2e', command, ...argv]
}

export function parsePort(value, name) {
  if (value === undefined || value === '') return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || FORBIDDEN_PORTS.has(String(port))) {
    throw new Error(`${name} must be an integer in 1024-65535 and not 3000/8069, got "${value}"`)
  }
  return port
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

// The replay cache is keyed by the app origin, so the defaults are stable
// ports; a random port is used only when the preferred one is taken.
export const PREFERRED = { mock: 43388, nuxt: 43300, odoo: 43369 }

export function isFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

export async function pickPorts(env = process.env, pick = freePort, free = isFree, stack = 'mock') {
  const choose = async (explicit, preferred) => explicit ?? ((await free(preferred)) ? preferred : await pick())
  const backend = stack === 'odoo' ? 'odoo' : 'mock'
  const backendPort = await choose(parsePort(env[`E2E_${backend.toUpperCase()}_PORT`], `E2E_${backend.toUpperCase()}_PORT`), PREFERRED[backend])
  const nuxt = await choose(parsePort(env.E2E_NUXT_PORT, 'E2E_NUXT_PORT'), PREFERRED.nuxt)
  if (backendPort === nuxt) throw new Error(`${backend} and Nuxt ports must differ`)
  return { [backend]: backendPort, nuxt }
}

function tail(file, lines = 30) {
  try {
    return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n')
  } catch {
    return '(no log)'
  }
}

function start(cmd, args, { cwd, env, logFile }) {
  const fd = openSync(logFile, 'w')
  // detached: own process group, so the whole tree (npx -> nuxt -> workers) can be killed.
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', fd, fd], detached: true })
  closeSync(fd)
  child.exited = new Promise((resolve) => child.once('exit', (code, sig) => resolve({ code, sig })))
  child.hasExited = false
  child.exited.then(() => { child.hasExited = true })
  return child
}

function killTree(child, signal) {
  if (!child || !child.pid) return
  try {
    process.kill(-child.pid, signal)
  } catch { /* already gone */ }
}

async function stop(child) {
  if (!child || child.hasExited) return
  killTree(child, 'SIGTERM')
  const timer = setTimeout(() => killTree(child, 'SIGKILL'), 5000)
  await child.exited
  clearTimeout(timer)
  killTree(child, 'SIGKILL') // stragglers in the group
}

async function waitFor(url, child, logFile, timeoutMs, label, anyStatus = false) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.hasExited) throw new Error(`${label} exited early.\n--- ${logFile} ---\n${tail(logFile)}`)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (anyStatus || res.status === 200) return
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${label} not ready at ${url} after ${timeoutMs / 1000}s.\n--- ${logFile} ---\n${tail(logFile)}`)
}

function runToEnd(cmd, args, { cwd, env, logFile, stdinFile }) {
  const out = openSync(logFile, 'a')
  const input = stdinFile ? openSync(stdinFile, 'r') : 'ignore'
  const result = spawnSync(cmd, args, { cwd, env, stdio: [input, out, out] })
  closeSync(out)
  if (stdinFile) closeSync(input)
  return result.status ?? 1
}

function psql(pg, sql) {
  const r = spawnSync('psql', ['-h', pg.host, '-p', pg.port, '-U', pg.user, '-d', 'postgres', '-Atc', sql], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`PostgreSQL is not reachable at ${pg.host}:${pg.port} as ${pg.user}: ${r.stderr.trim()}`)
  return r.stdout.trim()
}

function dbExists(pg, db) {
  assertScratchDb(db)
  return psql(pg, `SELECT 1 FROM pg_database WHERE datname = '${db}'`) === '1'
}

function dropDb(pg, db) {
  assertScratchDb(db)
  psql(pg, `DROP DATABASE IF EXISTS ${db}`)
}

// Create (or reuse) the scratch database. First run installs every release
// module and seeds users through `odoo-bin shell`; later runs reuse it.
function prepareOdoo({ port, pg, env }) {
  const db = assertScratchDb(SCRATCH_DB)
  mkdirSync(join(ODOO_DIR, 'data'), { recursive: true })
  mkdirSync(join(ODOO_DIR, 'logs'), { recursive: true })
  const conf = join(ODOO_DIR, 'odoo.conf')
  const logFile = join(ODOO_DIR, 'logs', 'odoo.log')
  const prepLog = join(ODOO_DIR, 'logs', 'prepare.log')
  const addonsPath = [join(ODOO_ROOT, 'odoo', 'addons'), join(ODOO_ROOT, 'addons'), join(ROOT, 'odoo-addons')]
  writeFileSync(conf, odooConf({ db, port, addonsPath, dataDir: join(ODOO_DIR, 'data'), logFile, pg }))
  const classification = join(ODOO_DIR, 'classification.json')
  rmSync(classification, { force: true })
  const fixture = spawnSync('python3', ['-B', 'deploy/classification.py', 'fixture', '--database', db, '--mode', 'saas', '--output', classification], { cwd: ROOT, encoding: 'utf8' })
  if (fixture.status !== 0) throw new Error(`classification fixture failed: ${fixture.stderr}`)
  const odooEnv = { ...env, PYTHONDONTWRITEBYTECODE: '1', NASQ_COMMERCIAL_CONFIG: classification, PGHOST: pg.host, PGPORT: pg.port, PGUSER: pg.user }
  const python = join(ODOO_ROOT, '.venv', 'bin', 'python')
  const bin = join(ODOO_ROOT, 'odoo-bin')
  if (!existsSync(bin)) throw new Error(`Odoo checkout not found at ${ODOO_ROOT}`)
  const odoo = (kind, extra) => runToEnd(python, [bin, ...odooArgs(kind, { conf, db, ...extra })], { cwd: ROOT, env: odooEnv, logFile: prepLog, ...(kind === 'shell' ? { stdinFile: join(ROOT, 'tools', 'e2e_seed.py') } : {}) })

  if (env.E2E_ODOO_RESET === '1' && dbExists(pg, db)) {
    console.error(`e2e_isolated: E2E_ODOO_RESET=1, dropping ${db}`)
    dropDb(pg, db)
  }
  rmSync(prepLog, { force: true })
  const modules = spawnSync('python3', ['-B', 'tools/catalog_check.py', '--release-modules'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  if (!dbExists(pg, db)) {
    console.error(`e2e_isolated: creating ${db} (installs every release module, several minutes; log ${prepLog})`)
    // A half-built database must not be reused as the fast path.
    const fail = (what) => {
      dropDb(pg, db)
      throw new Error(`${what} failed; dropped ${db}.\n--- ${prepLog} ---\n${tail(prepLog)}`)
    }
    if (odoo('install', { modules }) !== 0) fail('module install')
    if (odoo('shell') !== 0) fail('seed')
  } else if (env.E2E_ODOO_UPDATE === '1') {
    console.error(`e2e_isolated: E2E_ODOO_UPDATE=1, updating ${db}`)
    if (odoo('update', { modules }) !== 0) throw new Error(`module update failed.\n--- ${prepLog} ---\n${tail(prepLog)}`)
    if (odoo('shell') !== 0) throw new Error(`seed failed.\n--- ${prepLog} ---\n${tail(prepLog)}`)
  } else if (env.E2E_ODOO_SEED === '1') {
    console.error(`e2e_isolated: E2E_ODOO_SEED=1, re-running the seed on ${db}`)
    if (odoo('shell') !== 0) throw new Error(`seed failed.\n--- ${prepLog} ---\n${tail(prepLog)}`)
  }
  return { python, bin, conf, odooEnv, logFile, db }
}

async function main() {
  const reason = refusalReason(process.env.E2E_BASE_URL)
  if (reason) {
    console.error(`e2e_isolated: ${reason}`)
    return 2
  }
  let stack
  try {
    stack = stackName()
  } catch (error) {
    console.error(`e2e_isolated: ${error.message}`)
    return 2
  }
  const timeoutMs = Number(process.env.E2E_STARTUP_TIMEOUT_MS || 180_000)
  const ports = await pickPorts(process.env, freePort, isFree, stack)
  const { nuxt } = ports
  mkdirSync(LOG_DIR, { recursive: true })
  const nuxtLog = join(LOG_DIR, 'nuxt.log')
  const children = []
  let cleaning = null
  const cleanup = () => (cleaning ??= Promise.all(children.map(stop)))
  let interrupted = null
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      interrupted ??= sig
      cleanup().finally(() => process.exit(128 + (sig === 'SIGINT' ? 2 : sig === 'SIGTERM' ? 15 : 1)))
    })
  }

  try {
    const baseEnv = { ...process.env }
    delete baseEnv.E2E_BASE_URL
    let backend
    if (stack === 'odoo') {
      const pg = pgSettings()
      const prepared = prepareOdoo({ port: ports.odoo, pg, env: baseEnv })
      const odooChild = start(prepared.python, [prepared.bin, ...odooArgs('serve', { conf: prepared.conf, db: prepared.db })], {
        cwd: ROOT,
        env: prepared.odooEnv,
        logFile: join(LOG_DIR, 'odoo-stdout.log'),
      })
      children.push(odooChild)
      await waitFor(`http://127.0.0.1:${ports.odoo}/web/health`, odooChild, prepared.logFile, 120_000, 'Odoo')
      backend = { url: `http://127.0.0.1:${ports.odoo}`, db: prepared.db, label: `odoo :${ports.odoo}` }
    } else {
      const mockLog = join(LOG_DIR, 'mock.log')
      const mockChild = start('node', ['e2e/internal-ui-audit-mock.mjs'], {
        cwd: WEB,
        env: { ...baseEnv, PROJECTS_UI_PREVIEW: '1', MODULE_UI_PREVIEW: '1', MOCK_PORT: String(ports.mock) },
        logFile: mockLog,
      })
      children.push(mockChild)
      await waitFor(`http://127.0.0.1:${ports.mock}/`, mockChild, mockLog, 30_000, 'mock API', true)
      backend = { url: `http://127.0.0.1:${ports.mock}`, db: MOCK_DB, label: `mock :${ports.mock}` }
    }
    const nuxtChild = start('npx', ['nuxt', 'dev', '--port', String(nuxt)], {
      cwd: WEB,
      env: {
        ...baseEnv,
        NUXT_ODOO_URL: backend.url,
        NUXT_ODOO_DB: backend.db,
        NUXT_PUBLIC_WS_URL: `${backend.url.replace('http', 'ws')}/websocket`,
      },
      logFile: nuxtLog,
    })
    children.push(nuxtChild)
    await waitFor(`http://localhost:${nuxt}/login`, nuxtChild, nuxtLog, timeoutMs, 'Nuxt dev server')
    console.error(`e2e_isolated: ${backend.label}, nuxt :${nuxt} (logs in .e2e/logs/)`)

    const [cmd, ...args] = ['npx', ...forwardArgs(process.argv.slice(2), e2eCommand())]
    const runner = spawn(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, E2E_BASE_URL: `http://localhost:${nuxt}`, E2E_TELEMETRY_DISABLED: '1' },
    })
    const { code, sig } = await new Promise((resolve) => runner.once('exit', (c, s) => resolve({ code: c, sig: s })))
    return code ?? (sig ? 128 : 1)
  } catch (error) {
    console.error(`e2e_isolated: ${error.message}`)
    return 1
  } finally {
    await cleanup()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code))
}
