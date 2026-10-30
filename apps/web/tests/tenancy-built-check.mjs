// Run explicitly after separate Nuxt builds; never discovered by Vitest.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const web = resolve(import.meta.dirname, '..')
const probe = resolve(import.meta.dirname, 'tenancy-built-probe.mjs')
async function check(built, runtime) {
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', NITRO_HOST: '127.0.0.1', NITRO_PORT: '0', LIWAN_TENANCY_MODE: runtime,
    // Attempts to forge a runtime-config/build stamp must have no effect.
    __LIWAN_BUILD_TENANCY_MODE__: runtime, NUXT_BUILD_TENANCY_MODE: runtime,
    NUXT_LIWAN_BUILD_TENANCY_MODE: runtime, NITRO_BUILD_TENANCY_MODE: runtime,
    NUXT_ODOO_URL: 'http://127.0.0.1:1', NUXT_ODOO_DB: 'synthetic_never_connect' }
  const child = spawn(process.execPath, ['--import', probe, resolve(web, `.output-t11-${built}/server/index.mjs`)], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''; let err = ''; let bound
  child.stdout.on('data', chunk => { out += chunk; const match = out.match(/T11_BOUND:(\{[^\n]+\})/); if (match) bound = JSON.parse(match[1]) })
  child.stderr.on('data', chunk => { err += chunk })
  const exited = once(child, 'exit')
  let timeout
  try {
    await Promise.race([
      new Promise((resolveWait, reject) => {
        const tick = setInterval(() => { if (bound || child.exitCode !== null || child.signalCode !== null) { clearInterval(tick); resolveWait() } }, 10)
        timeout = setTimeout(() => { clearInterval(tick); reject(Error('child_timeout')) }, 15000)
      }), exited,
    ])
    if (built === runtime) {
      assert.ok(bound, `matching startup failed: ${err}`)
      assert.equal(bound.address, '127.0.0.1')
      assert.ok(bound.port > 0)
    } else {
      const [code] = await exited
      assert.notEqual(code, 0)
      assert.match(err, /tenancy_build_runtime_mismatch/)
      assert.doesNotMatch(out, /T11_LISTEN_ATTEMPT/)
    }
    console.log(JSON.stringify({ built, runtime, matching: built === runtime, bound: bound ?? null, listenAttempt: out.includes('T11_LISTEN_ATTEMPT'), guardRejected: err.includes('tenancy_build_runtime_mismatch') }))
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 3000)
    await exited
    clearTimeout(kill)
    assert.ok(child.exitCode !== null || child.signalCode !== null)
  }
}
for (const built of ['dedicated', 'shared']) {
  for (const runtime of ['dedicated', 'shared', 'invalid']) await check(built, runtime)
}
console.log('ALL_CHILDREN_EXITED')
