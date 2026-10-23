import http from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { ApiErrorSchema } from '../../../../../packages/contracts/src/common/error'

afterEach(() => vi.resetModules())

async function fixture() {
  vi.resetModules()
  const { requireApiSession } = await import('../apiSessionAdmission')
  const { withUpstreamSlot } = await import('../tenantTransport')
  const held: Array<() => void> = []
  const waiting: Array<() => void> = []
  const probes: string[] = []
  let active = 0
  let maxActive = 0
  let hold = false
  let unavailable = false
  const upstream = http.createServer((req, res) => {
    req.resume()
    // Model the deployed two HTTP worker processes: a request retains one worker
    // until its response finishes, and all other requests wait for a free worker.
    const serve = () => {
      active++
      maxActive = Math.max(maxActive, active)
      let finished = false
      const release = () => {
        if (finished) return
        finished = true
        active--
        waiting.shift()?.()
      }
      res.once('finish', release)
      res.once('close', release)
      if (req.url !== '/api/v1/me') { res.end('application'); return }
      probes.push(req.headers.cookie ?? '')
      const respond = () => {
        if (unavailable) { res.statusCode = 503; res.end('{}'); return }
        if (req.headers.cookie !== 'session_id=verified') { res.statusCode = 403; res.end('{}'); return }
        res.end(JSON.stringify({ id: 7, company: { id: 1 } }))
      }
      if (hold) held.push(respond); else respond()
    }
    if (active < 2) serve(); else waiting.push(serve)
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use(defineEventHandler(async event => {
    await requireApiSession(event, upstreamUrl, {})
    const response = await withUpstreamSlot(signal => fetch(upstreamUrl + '/api/v1/tasks', { signal }), event)
    return response.text()
  }))
  const app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(app.address() as { port: number }).port}`
  return {
    probes, held,
    get active() { return active }, get maxActive() { return maxActive }, get waiting() { return waiting.length },
    hold() { hold = true }, outage() { unavailable = true },
    call(session?: string) { return fetch(url, { headers: session ? { cookie: `session_id=${session}` } : {} }) },
    async close() {
      hold = false
      for (const release of held) release()
      for (const server of [app, upstream]) {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    },
  }
}

// Omitting message from admission data breaks the same strict schema useApi consumes.
it.each([
  ['missing', 403, 'session_required', 'A valid session is required.'],
  ['forged', 403, 'session_required', 'A valid session is required.'],
  ['outage', 503, 'session_validation_unavailable', 'Session validation is temporarily unavailable.'],
] as const)('returns the complete strict API envelope for %s admission', async (kind, status, code, message) => {
  const wire = await fixture()
  try {
    if (kind === 'outage') wire.outage()
    const response = await wire.call(kind === 'missing' ? undefined : kind)
    expect(response.status).toBe(status)
    const body = await response.json()
    expect(ApiErrorSchema.parse(body.data)).toEqual({ code, message })
  } finally { await wire.close() }
})

// Allowing two forged probes consumes both fixture workers and stalls warm work.
it('reserves one of two HTTP workers for verified work while rejecting an excess cold probe', async () => {
  const wire = await fixture()
  const pending: Array<Promise<Response>> = []
  try {
    expect(await (await wire.call('verified')).text()).toBe('application')
    wire.hold()
    pending.push(wire.call('forged-a'))
    await vi.waitFor(() => expect(wire.held).toHaveLength(1))
    let excessStatus: number | undefined
    let warmBody: string | undefined
    const excess = wire.call('forged-b').then(response => { excessStatus = response.status; return response })
    pending.push(excess)
    const warm = wire.call('verified').then(response => response.text()).then(body => { warmBody = body })
    await vi.waitFor(() => {
      expect(excessStatus).toBe(429)
      expect(warmBody).toBe('application')
    }, { timeout: 500 })
    const body = await (await excess).json()
    expect(ApiErrorSchema.parse(body.data)).toEqual({ code: 'session_admission_busy', message: 'Session validation is busy. Try again shortly.' })
    await warm
    expect(wire.probes).toEqual(['session_id=verified', 'session_id=forged-a'])
    expect(wire.active).toBe(1)
    expect(wire.maxActive).toBe(2)
    expect(wire.waiting).toBe(0)
    wire.held[0]!()
    expect((await pending[0]!).status).toBe(403)
    // Once the probe finishes, the lane accepts another identity check.
    wire.held.length = 0
    const recovery = wire.call('forged-recovery')
    pending.push(recovery)
    await vi.waitFor(() => expect(wire.held).toHaveLength(1))
    wire.held[0]!()
    expect((await recovery).status).toBe(403)
  } finally { await wire.close(); await Promise.allSettled(pending) }
})
