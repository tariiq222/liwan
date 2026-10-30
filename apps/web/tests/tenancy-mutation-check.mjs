import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const web = resolve(import.meta.dirname, '..')
async function check(built, runtime, mutate) {
  const artifact = resolve(web, `.output-t16-${built}`)
  const child = spawn(process.execPath, ['--import', resolve(import.meta.dirname, 'tenancy-mutation-probe.mjs'), resolve(artifact, 'server/index.mjs')], {
    env: { PATH: process.env.PATH, NODE_ENV: 'production', LIWAN_TENANCY_MODE: runtime, HOST: '127.0.0.1', PORT: '0', NUXT_ODOO_URL: 'http://127.0.0.1:1' }, stdio: ['ignore','pipe','pipe','ipc'],
  })
  let out = ''; let err = ''
  child.stdout.on('data', x => out += x); child.stderr.on('data', x => err += x)
  const exited = once(child, 'exit')
  let timer
  const bound = new Promise(resolveBound => child.on('message', m => { if (m.bound) resolveBound(m.bound) }))
  try {
    const result = await Promise.race([bound, exited.then(([code]) => ({ code })), new Promise((_, reject) => timer = setTimeout(() => reject(Error('startup_timeout')), 15000))])
    if (built !== runtime) {
      assert.notEqual(result.code, 0); assert.match(err, /tenancy_build_runtime_mismatch/); assert.doesNotMatch(out, /T16_LISTEN_ATTEMPT/)
      console.log(JSON.stringify({ built, runtime, startupRejected: true })); return
    }
    assert.equal(result.address, '127.0.0.1'); assert.ok(result.port > 0)
    const asset = readdirSync(resolve(artifact, 'public/_nuxt')).find(n => n.endsWith('.js'))
    assert.ok(asset)
    const base = `http://127.0.0.1:${result.port}`
    const positive = await fetch(`${base}/_nuxt/${asset}`)
    assert.equal(positive.status, 200); await positive.arrayBuffer()
    const ack = new Promise(resolveAck => child.on('message', m => { if (m.mutated === mutate) resolveAck() }))
    child.send({ mode: mutate }); await ack
    for (const path of [`/_nuxt/${asset}`, '/web/test', '/api/v1/projects']) {
      const response = await fetch(base + path)
      assert.equal(response.status, 500)
      const body = await response.text()
      assert.ok(body.length > 0)
    }
    assert.match(err, /tenancy_build_runtime_mismatch/)
    assert.doesNotMatch(out, /T16_OUTBOUND_ATTEMPT/)
    console.log(JSON.stringify({ built, runtime, mutated: mutate, staticPositive: 200, rejectedPaths: 3, outboundAttempts: 0 }))
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 3000)
    await exited; clearTimeout(kill)
  }
}
for (const built of ['dedicated','shared']) {
  for (const runtime of ['dedicated','shared','invalid']) await check(built, runtime, built === 'shared' ? 'dedicated' : 'shared')
}
console.log('ALL_T16_CHILDREN_EXITED')
