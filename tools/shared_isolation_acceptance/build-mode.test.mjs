// A built Nuxt server refuses to run in a tenancy mode other than the one it was built for
// (apps/web/server/plugins/tenancy-build-mode.ts), on the real build output:
// - startup with a mismatched or invalid LIWAN_TENANCY_MODE exits before listening;
// - forged build-stamp variables in the environment change nothing;
// - a matching server that has its mode changed at runtime answers 500 on every path and makes no outbound call.
// Needs both builds: LIWAN_ACCEPTANCE_ARTIFACT (built with LIWAN_TENANCY_MODE=shared) and
// LIWAN_ACCEPTANCE_DEDICATED_ARTIFACT (the default build). deploy/ci/lib/tenancy-isolation.sh provides them.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url).pathname
const dedicated = process.env.LIWAN_ACCEPTANCE_DEDICATED_ARTIFACT
if (!dedicated) throw new Error('set LIWAN_ACCEPTANCE_DEDICATED_ARTIFACT to a default (dedicated) build, or run deploy/ci/lib/tenancy-isolation.sh')
const artifacts = {
  shared: resolve(process.env.LIWAN_ACCEPTANCE_ARTIFACT ?? join(root, 'apps/web/.output')),
  dedicated: resolve(dedicated),
}
const probe = new URL('./build-mode-probe.mjs', import.meta.url).pathname
// Attempts to forge the build stamp through the environment must have no effect.
const forgedStamps = mode => ({ __LIWAN_BUILD_TENANCY_MODE__: mode, NUXT_BUILD_TENANCY_MODE: mode, NUXT_LIWAN_BUILD_TENANCY_MODE: mode, NITRO_BUILD_TENANCY_MODE: mode })

async function check(built, runtime) {
  const artifact = artifacts[built]
  assert.ok(existsSync(join(artifact, 'server/index.mjs')), `missing ${built} build at ${artifact}`)
  const child = spawn(process.execPath, ['--import', probe, join(artifact, 'server/index.mjs')], {
    env: { PATH: process.env.PATH, NODE_ENV: 'production', LIWAN_TENANCY_MODE: runtime, HOST: '127.0.0.1', PORT: '0', NUXT_ODOO_URL: 'http://127.0.0.1:1', NUXT_ODOO_DB: 'synthetic_never_connect', ...forgedStamps(runtime) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let out = ''; let err = ''
  child.stdout.on('data', x => { out += x }); child.stderr.on('data', x => { err += x })
  const exited = once(child, 'exit')
  let timer
  const bound = new Promise(resolveBound => child.on('message', m => { if (m.bound) resolveBound(m.bound) }))
  try {
    const result = await Promise.race([bound, exited.then(([code]) => ({ code })), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('startup_timeout')), 15000) })])
    if (built !== runtime) {
      assert.notEqual(result.code, 0, `${built} build started in ${runtime} mode`)
      assert.match(err, /tenancy_build_runtime_mismatch/)
      assert.doesNotMatch(out, /BUILD_MODE_LISTEN_ATTEMPT/)
      return
    }
    assert.equal(result.address, '127.0.0.1', `matching ${built} startup failed: ${err}`); assert.ok(result.port > 0)
    const asset = readdirSync(join(artifact, 'public/_nuxt')).find(n => n.endsWith('.js'))
    assert.ok(asset)
    const base = `http://127.0.0.1:${result.port}`
    const positive = await fetch(`${base}/_nuxt/${asset}`)
    assert.equal(positive.status, 200); await positive.arrayBuffer()
    const mutate = built === 'shared' ? 'dedicated' : 'shared'
    const ack = new Promise(resolveAck => child.on('message', m => { if (m.mutated === mutate) resolveAck() }))
    child.send({ mode: mutate }); await ack
    for (const path of [`/_nuxt/${asset}`, '/web/test', '/api/v1/projects']) {
      const response = await fetch(base + path)
      assert.equal(response.status, 500, `${path} answered after the mode changed to ${mutate}`)
      assert.ok((await response.text()).length > 0)
    }
    assert.match(err, /tenancy_build_runtime_mismatch/)
    assert.doesNotMatch(out, /BUILD_MODE_OUTBOUND_ATTEMPT/)
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 3000)
    await exited; clearTimeout(kill)
  }
}

for (const built of ['dedicated', 'shared']) {
  for (const runtime of ['dedicated', 'shared', 'invalid']) {
    test(`${built} build with LIWAN_TENANCY_MODE=${runtime}`, { timeout: 30000 }, () => check(built, runtime))
  }
}
