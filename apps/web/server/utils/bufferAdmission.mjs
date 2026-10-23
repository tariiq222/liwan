/** Fixed operator memory budget, independent of tenant count and Odoo workers. */
const BUFFER_TIMEOUT = 15_000
const ACTIVE_BUFFERS = 4
const QUEUED_BUFFERS = 64

const bufferAdmissionFailure = () => Object.assign(Error('tenant_upstream_unavailable'), {
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
 * @param {boolean} skipBodyless
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<() => void>}
 */
function createAdmission(skipBodyless) {
  let active = 0
  /** @type {Array<() => void>} */
  const waiting = []
  const release = () => { const next = waiting.shift(); if (next) next(); else active-- }
  const credit = () => { let held = true; return () => { if (held) { held = false; release() } } }
  return (req, res) => {
    if (skipBodyless && ['GET', 'HEAD'].includes(req.method ?? 'GET')) return Promise.resolve(() => {})
    if (disconnected(req, res)) return Promise.reject(bufferAdmissionFailure())
    if (active < ACTIVE_BUFFERS) { active++; return Promise.resolve(credit()) }
    if (waiting.length >= QUEUED_BUFFERS) { closeAfterError(res); return Promise.reject(bufferAdmissionFailure()) }
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
        waiting.splice(index, 1); cleanup(); closeAfterError(res); reject(bufferAdmissionFailure())
      }
      const onClose = () => { if (!res.writableEnded) cancel() }
      const resume = () => { cleanup(); resolve(credit()) }
      const timer = setTimeout(cancel, BUFFER_TIMEOUT)
      waiting.push(resume)
      req.once('aborted', cancel); req.once('error', cancel); res.once('close', onClose)
    })
  }
}

/** Incoming-body pools do not consume credits for GET/HEAD. */
export function createBodyAdmission() { return createAdmission(true) }

/** Response buffers belong to both the operation and its actual HTTP output.
 * H3's native Response sender can settle before ServerResponse drains.
 */
export function createResponseAdmission() {
  const acquire = createAdmission(false)
  /** @template T
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {() => Promise<T>} run
   * @returns {Promise<T>}
   */
  return async function withResponse(req, res, run) {
    const release = await acquire(req, res)
    let operationSettled = false
    let outputSettled = res.writableFinished || res.closed
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let drainTimer
    const releaseWhenSettled = () => {
      if (!operationSettled || !outputSettled) return
      clearTimeout(drainTimer)
      res.removeListener('finish', outputDone); res.removeListener('close', outputDone)
      release()
    }
    const outputDone = () => { outputSettled = true; releaseWhenSettled() }
    if (!outputSettled) { res.once('finish', outputDone); res.once('close', outputDone) }
    try {
      if (disconnected(req, res)) throw bufferAdmissionFailure()
      return await run()
    } finally {
      operationSettled = true
      // Start only after native/claimed work has settled. Never cancel that work
      // to reclaim memory; only its already-complete downstream output expires.
      if (!outputSettled && !res.writableFinished && !res.closed) drainTimer = setTimeout(() => res.destroy(), BUFFER_TIMEOUT)
      else outputSettled = true
      releaseWhenSettled()
    }
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
  if (disconnected(req, res)) return Promise.reject(bufferAdmissionFailure())
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
    const failed = () => finish(bufferAdmissionFailure())
    const closed = () => { if (!res.writableEnded) failed() }
    const timer = setTimeout(failed, BUFFER_TIMEOUT)
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', failed); res.once('close', closed)
  })
}
