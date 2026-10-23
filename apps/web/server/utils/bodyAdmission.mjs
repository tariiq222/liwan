/** Fixed operator memory budget, independent of tenant count and Odoo workers. */
const BODY_TIMEOUT = 15_000
const ACTIVE_BODIES = 4
const QUEUED_BODIES = 64

const bodyAdmissionFailure = () => Object.assign(Error('tenant_upstream_unavailable'), {
  statusCode: 502,
  data: { code: 'tenant_upstream_unavailable', message: 'The upstream service is temporarily unavailable.' },
})
/** @param {import('node:http').ServerResponse} res */
function closeAfterError(res) { if (!res.headersSent && !res.destroyed) res.setHeader('connection', 'close') }
/** @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res */
function disconnected(req, res) { return req.aborted || (res.destroyed && !res.writableEnded) }

/** One pool per buffering hop/process, never per tenant. The owner releases only after
 * its callback/forwarder settles, so completed bodies waiting for work retain credit.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<() => void>}
 */
export function createBodyAdmission() {
  let active = 0
  /** @type {Array<() => void>} */
  const waiting = []
  const release = () => { const next = waiting.shift(); if (next) next(); else active-- }
  const credit = () => { let held = true; return () => { if (held) { held = false; release() } } }
  return (req, res) => {
    if (['GET', 'HEAD'].includes(req.method ?? 'GET')) return Promise.resolve(() => {})
    if (disconnected(req, res)) return Promise.reject(bodyAdmissionFailure())
    if (active < ACTIVE_BODIES) { active++; return Promise.resolve(credit()) }
    if (waiting.length >= QUEUED_BODIES) { closeAfterError(res); return Promise.reject(bodyAdmissionFailure()) }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        req.removeListener('aborted', cancel)
        req.removeListener('error', cancel)
        res.removeListener('close', onClose)
      }
      const cancel = () => {
        const index = waiting.indexOf(resume)
        if (index < 0) return
        waiting.splice(index, 1); cleanup(); closeAfterError(res); reject(bodyAdmissionFailure())
      }
      const onClose = () => { if (!res.writableEnded) cancel() }
      const resume = () => { cleanup(); resolve(credit()) }
      const timer = setTimeout(cancel, BODY_TIMEOUT)
      waiting.push(resume)
      req.once('aborted', cancel); req.once('error', cancel); res.once('close', onClose)
    })
  }
}

/** Read once under a total deadline without destroying the socket before the error
 * response can be serialized. Pausing and removing listeners stops body consumption.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
export function readBodyBytes(req, res, maxBytes) {
  const oversized = () => Object.assign(Error('payload_too_large'), { statusCode: 413, data: { code: 'payload_too_large', message: 'The request body exceeds the allowed size.' } })
  if (Number(req.headers?.['content-length']) > maxBytes) { closeAfterError(res); return Promise.reject(oversized()) }
  if (disconnected(req, res)) return Promise.reject(bodyAdmissionFailure())
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    let bytes = 0
    let settled = false
    /** @param {Error} [error] */
    const finish = error => {
      if (settled) return
      settled = true; clearTimeout(timer); req.pause()
      req.removeListener('data', data); req.removeListener('end', end)
      req.removeListener('error', failed); req.removeListener('aborted', failed); res.removeListener('close', closed)
      if (error) { closeAfterError(res); reject(error) } else resolve(Buffer.concat(chunks, bytes))
    }
    /** @param {Buffer|string} chunk */
    const data = chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > maxBytes) { finish(oversized()); return }
      chunks.push(buffer)
    }
    const end = () => finish()
    const failed = () => finish(bodyAdmissionFailure())
    const closed = () => { if (!res.writableEnded) failed() }
    const timer = setTimeout(failed, BODY_TIMEOUT)
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', failed); res.once('close', closed)
  })
}
