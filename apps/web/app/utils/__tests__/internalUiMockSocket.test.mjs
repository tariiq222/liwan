import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Removing the upgraded-socket reset handler must make this fail: a browser
// abandoning its WebSocket must not take the HTTP fixture service down with it.
it('keeps HTTP authentication alive after an upgraded client resets its socket', async () => {
  const reservation = net.createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))

  const script = fileURLToPath(new URL('../../../e2e/internal-ui-audit-mock.mjs', import.meta.url))
  const child = spawn(process.execPath, [script], { env: { ...process.env, MOCK_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  const exited = once(child, 'exit')
  let client
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`mock startup timed out: ${errors}`)), 5_000)
      child.on('error', reject)
      child.stdout.on('data', chunk => {
        output += chunk
        if (output.includes(`mock listening 127.0.0.1:${port}`)) {
          clearTimeout(timeout)
          resolve()
        }
      })
      child.once('exit', code => {
        clearTimeout(timeout)
        reject(new Error(`mock exited during startup (${code}): ${errors}`))
      })
    })

    client = net.createConnection({ host: '127.0.0.1', port })
    await once(client, 'connect')
    const response = once(client, 'data')
    client.write('GET /websocket HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n')
    expect((await response)[0].toString()).toMatch(/^HTTP\/1\.1 101 Switching Protocols/)
    const closed = once(client, 'close')
    client.resetAndDestroy()
    await closed
    // Give the subprocess a bounded chance to observe the actual TCP reset;
    // a later successful HTTP request alone could otherwise race that event.
    await Promise.race([exited, delay(150)])
    expect(child.exitCode, errors).toBeNull()

    const login = await fetch(`http://127.0.0.1:${port}/web/session/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { db: 'webvue_ui_mock_only', login: 'admin', password: 'admin' } }),
    })
    expect(login.status).toBe(200)
    expect((await login.json()).result.uid).toBe(2)
    expect(login.headers.get('set-cookie')).toContain('session_id=webvue-ui-mock;')
  } finally {
    client?.destroy()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await exited
  }
}, 10_000)
