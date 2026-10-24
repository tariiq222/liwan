import http from 'node:http'
import { EventEmitter, once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
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

afterEach(() => { vi.useRealTimers() })

const session = (res: unknown) => ({ req: Object.assign(new EventEmitter(), { method: 'GET', aborted: false }) as unknown as http.IncomingMessage, res: res as http.ServerResponse })
/** Shape of the node-mock-http response behind Nitro's in-process `$fetch`: an EventEmitter with no socket. */
const inProcessResponse = () => Object.assign(new EventEmitter(), { writableFinished: false, closed: false, destroyed: false, writableEnded: false, headersSent: false, socket: null })
/** An unattached but genuine `http.ServerResponse`: output stays unsettled until it is closed. */
const stalledRealResponse = () => new http.ServerResponse(new http.IncomingMessage(undefined as never))

it('releases the credit of in-process responses as soon as the operation settles', async () => {
  vi.useFakeTimers()
  const admission = createResponseAdmission('session')
  let completed = 0
  const operations = Array.from({ length: 5 }, () => {
    const { req, res } = session(inProcessResponse())
    return admission(req, res, async () => {}).then(() => { completed++ })
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(completed).toBe(5)
  await Promise.all(operations)
  const { req, res } = session(stalledRealResponse())
  let entered = false
  void admission(req, res, async () => { entered = true })
  await vi.advanceTimersByTimeAsync(0)
  expect(entered).toBe(true)
})

it('holds a real response credit until its output settles and destroys it after the drain timeout', async () => {
  vi.useFakeTimers()
  const admission = createResponseAdmission('session')
  const stalled = Array.from({ length: 4 }, () => {
    const res = stalledRealResponse()
    const destroy = vi.spyOn(res, 'destroy').mockImplementation(() => { res.emit('close'); return res })
    void admission(session(res).req, res, async () => {})
    return destroy
  })
  await vi.advanceTimersByTimeAsync(0)
  let entered = false
  const queued = session(inProcessResponse())
  void admission(queued.req, queued.res, async () => { entered = true })
  await vi.advanceTimersByTimeAsync(14_999)
  expect(entered).toBe(false)
  for (const destroy of stalled) expect(destroy).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  for (const destroy of stalled) expect(destroy).toHaveBeenCalledOnce()
  expect(entered).toBe(true)
})
