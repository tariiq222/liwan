import http from 'node:http'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { createResponseAdmission } from '../bufferAdmission.mjs'

const listen = (server: http.Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)))
it('cleans listeners and returns response credits after real fast finish, failure and already-finished output', async () => {
  const admission = createResponseAdmission('session')
  const rows: http.ServerResponse[] = []
  let completed = 0
  const server = http.createServer(async (req, res) => {
    rows.push(res)
    try {
      if (req.url === '/already-finished') {
        const finished = once(res, 'finish')
        res.end('ok'); await finished
        await admission(req, res, async () => {})
      } else {
        await admission(req, res, async () => {
          if (req.url === '/throw') throw Error('fixture failure')
          const finished = once(res, 'finish')
          res.end('ok'); await finished
          // Both events can be observed; they must not return a credit twice.
          res.emit('close')
        })
      }
    } catch { res.writeHead(502); res.end('failed') }
    finally { completed++ }
  })
  const url = await listen(server)
  const call = (path: string) => new Promise<number>((resolve, reject) => {
    const req = http.get(new URL(path, url), res => { res.resume(); res.once('end', () => resolve(res.statusCode!)) }); req.once('error', reject)
  })
  try {
    for (let batch = 0; batch < 3; batch++) {
      expect(await Promise.all(['/fast', '/throw', '/already-finished', '/fast'].map(call))).toEqual([200, 502, 200, 200])
    }
    expect(completed).toBe(12)
    for (const res of rows) {
      expect(res.listeners('finish').some(listener => listener.name === 'outputDone')).toBe(false)
      expect(res.listeners('close').some(listener => listener.name === 'outputDone')).toBe(false)
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('holds all four credits after real HTTP finish until the corresponding callbacks settle', async () => {
  const admission = createResponseAdmission('session')
  const pending: Array<() => void> = []
  let entered = 0
  const server = http.createServer(async (req, res) => {
    await admission(req, res, async () => {
      entered++
      const finished = once(res, 'finish')
      res.end('ok'); await finished
      if (req.url !== '/next') await new Promise<void>(resolve => pending.push(resolve))
    })
  })
  const url = await listen(server)
  const call = (path: string) => new Promise<void>((resolve, reject) => {
    const req = http.get(new URL(path, url), res => { res.resume(); res.once('end', resolve) }); req.once('error', reject)
  })
  try {
    await Promise.all(Array.from({ length: 4 }, (_, index) => call('/held?id=' + index)))
    expect(pending).toHaveLength(4)
    const next = call('/next')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(entered).toBe(4)
    const first = pending.shift()
    if (!first) throw Error('missing finished callback owner')
    first(); await next
    expect(entered).toBe(5)
  } finally {
    for (const resolve of pending.splice(0)) resolve()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
