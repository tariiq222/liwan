#!/usr/bin/env node
// Run the agentic e2e runner against an isolated stack: the repo mock API plus
// a private Nuxt dev server on free ports. Never touches :3000, :8069 or the
// dev `odoo19` database. All CLI args are forwarded to `npx e2e run`.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = join(ROOT, 'apps', 'web')
const LOG_DIR = join(ROOT, '.e2e', 'logs')
const FORBIDDEN_PORTS = new Set(['3000', '8069'])
const MOCK_DB = 'nasq_ui_mock_only'

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

export function forwardArgs(argv) {
  return ['e2e', 'run', ...argv]
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
export const PREFERRED = { mock: 43388, nuxt: 43300 }

export function isFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

export async function pickPorts(env = process.env, pick = freePort, free = isFree) {
  const choose = async (explicit, preferred) => explicit ?? ((await free(preferred)) ? preferred : await pick())
  const mock = await choose(parsePort(env.E2E_MOCK_PORT, 'E2E_MOCK_PORT'), PREFERRED.mock)
  const nuxt = await choose(parsePort(env.E2E_NUXT_PORT, 'E2E_NUXT_PORT'), PREFERRED.nuxt)
  if (mock === nuxt) throw new Error('mock and Nuxt ports must differ')
  return { mock, nuxt }
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

async function main() {
  const reason = refusalReason(process.env.E2E_BASE_URL)
  if (reason) {
    console.error(`e2e_isolated: ${reason}`)
    return 2
  }
  const timeoutMs = Number(process.env.E2E_STARTUP_TIMEOUT_MS || 180_000)
  const { mock, nuxt } = await pickPorts()
  mkdirSync(LOG_DIR, { recursive: true })
  const mockLog = join(LOG_DIR, 'mock.log')
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
    const mockChild = start('node', ['e2e/internal-ui-audit-mock.mjs'], {
      cwd: WEB,
      env: { ...baseEnv, PROJECTS_UI_PREVIEW: '1', MODULE_UI_PREVIEW: '1', MOCK_PORT: String(mock) },
      logFile: mockLog,
    })
    children.push(mockChild)
    await waitFor(`http://127.0.0.1:${mock}/`, mockChild, mockLog, 30_000, 'mock API', true)
    const nuxtChild = start('npx', ['nuxt', 'dev', '--port', String(nuxt)], {
      cwd: WEB,
      env: {
        ...baseEnv,
        NUXT_ODOO_URL: `http://127.0.0.1:${mock}`,
        NUXT_ODOO_DB: MOCK_DB,
        NUXT_PUBLIC_WS_URL: `ws://127.0.0.1:${mock}/websocket`,
      },
      logFile: nuxtLog,
    })
    children.push(nuxtChild)
    await waitFor(`http://localhost:${nuxt}/login`, nuxtChild, nuxtLog, timeoutMs, 'Nuxt dev server')
    console.error(`e2e_isolated: mock :${mock}, nuxt :${nuxt} (logs in .e2e/logs/)`)

    const [cmd, ...args] = ['npx', ...forwardArgs(process.argv.slice(2))]
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
