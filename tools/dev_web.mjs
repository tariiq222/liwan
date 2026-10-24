#!/usr/bin/env node
// Select this checkout's development profile before Nuxt can resolve config or dependencies.
import { spawn } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function stat(path) {
  try { return lstatSync(path) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function ownDependencies(root) {
  const dependencies = join(root, 'node_modules')
  if (!stat(dependencies)?.isDirectory()) throw new Error('Install independent node_modules in this checkout with npm ci --ignore-scripts.')
  for (const path of ['apps/web/node_modules', 'apps/web/.nuxt']) {
    if (stat(join(root, path))?.isSymbolicLink()) throw new Error(`${path} must be independent within this checkout.`)
  }
  const boundary = realpathSync(dependencies)
  const cli = join(dependencies, '@nuxt/cli/bin/nuxi.mjs')
  for (const path of [cli, join(dependencies, 'nuxt/package.json')]) {
    if (!stat(path)) throw new Error('Install independent Nuxt dependencies in this checkout with npm ci --ignore-scripts.')
    const location = relative(boundary, realpathSync(path))
    if (location.startsWith('..') || isAbsolute(location)) throw new Error('Nuxt dependencies must resolve within this checkout.')
  }
  return cli
}

function port(value, key) {
  if (!/^\d+$/.test(value ?? '') || Number(value) < 1024 || Number(value) > 65535 || ['3000', '8069'].includes(String(Number(value)))) {
    throw new Error(`Invalid ${key} in .env.worktree; use an isolated port in 1024-65535.`)
  }
  return Number(value)
}

function endpoint(value, key, websocket) {
  let url
  try { url = new URL(value) } catch { throw new Error(`Invalid ${key} in .env.worktree.`) }
  if (!(websocket ? ['ws:', 'wss:'] : ['http:', 'https:']).includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || url.pathname !== (websocket ? '/websocket' : '/')) {
    throw new Error(`Invalid ${key} in .env.worktree; use the isolated local backend.`)
  }
  port(url.port, key)
  return url
}

export function createDevLaunch({ root = ROOT, env = process.env, args = [] } = {}) {
  root = resolve(root)
  const cli = ownDependencies(root)
  const cwd = join(root, 'apps/web')
  // Git stores a file at the root of linked worktrees and a directory in the main checkout.
  const worktree = stat(join(root, '.git'))?.isFile() ?? false
  if (!worktree) return { cwd, env: { ...env }, args: [cli, 'dev', ...args], worktree }
  const profilePath = join(root, '.env.worktree')
  if (!stat(profilePath)?.isFile()) throw new Error('Missing .env.worktree; configure this worktree before starting development.')
  if (args.length) throw new Error('Configure worktree dev options in .env.worktree; CLI overrides are not accepted.')
  const profile = parseEnv(readFileSync(profilePath, 'utf8'))
  const frontendPort = port(profile.NUXT_PORT, 'NUXT_PORT')
  const backendPort = port(profile.ODOO_HTTP_PORT, 'ODOO_HTTP_PORT')
  const backend = endpoint(profile.NUXT_ODOO_URL, 'NUXT_ODOO_URL', false)
  const websocket = endpoint(profile.NUXT_PUBLIC_WS_URL, 'NUXT_PUBLIC_WS_URL', true)
  if (Number(backend.port) !== backendPort || Number(websocket.port) !== backendPort || frontendPort === backendPort) {
    throw new Error('Inconsistent frontend/backend ports in .env.worktree.')
  }
  if (!/^webvue_scratch_[a-z0-9_]+$/.test(profile.NUXT_ODOO_DB ?? '')) throw new Error('NUXT_ODOO_DB in .env.worktree must name a worktree scratch database.')
  if (profile.WEBVUE_TENANCY_MODE && profile.WEBVUE_TENANCY_MODE !== 'dedicated') throw new Error('.env.worktree local backend requires dedicated tenancy.')
  return {
    cwd,
    env: { ...env, ...profile, WEBVUE_TENANCY_MODE: 'dedicated' },
    args: [cli, 'dev', '--dotenv', profilePath, '--port', String(frontendPort), '--strictPort', '--no-takeover'],
    worktree,
  }
}

function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run') || process.env.npm_config_dry_run === 'true'
  const launch = createDevLaunch({ args: args.filter(arg => arg !== '--dry-run') })
  if (dryRun) {
    console.log(`Development configuration valid (${launch.worktree ? 'worktree' : 'main'}); no server started.`)
    return
  }
  const child = spawn(process.execPath, launch.args, { cwd: launch.cwd, env: launch.env, stdio: 'inherit' })
  const forwardInterrupt = () => { child.kill('SIGINT') }
  const forwardTerminate = () => { child.kill('SIGTERM') }
  const removeSignalHandlers = () => {
    process.off('SIGINT', forwardInterrupt)
    process.off('SIGTERM', forwardTerminate)
  }
  process.on('SIGINT', forwardInterrupt)
  process.on('SIGTERM', forwardTerminate)
  child.on('error', () => {
    removeSignalHandlers()
    console.error('Unable to start the checkout-local Nuxt CLI.')
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    removeSignalHandlers()
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
  })
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
