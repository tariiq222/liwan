import { getHeader, type H3Event } from 'h3'
import { BffError, bffFail } from './errors'

// Same cap as the control plane (apps/control-plane/src/http.ts) and the edge (deploy/vendor-admin/Caddyfile.snippet).
export const MAX_BODY_BYTES = 64 * 1024
const CLOSE_GRACE_MS = 200

/** Where a body that is not a JSON object is rejected: the proxy keeps its historic 400, auth routes answer 422. */
export type InvalidBody = { status: number; code: string }
export const PROXY_INVALID: InvalidBody = { status: 400, code: 'invalid_json' }
export const AUTH_INVALID: InvalidBody = { status: 422, code: 'invalid' }

/**
 * Reads the request stream and stops at the cap: the rest of an oversized upload is never
 * buffered, and the connection is closed once the 413 has been sent.
 */
function readCapped(event: H3Event): Promise<string> {
  const { req, res } = event.node
  const { socket } = req
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) { chunks.push(chunk); return }
      // Stop reading (the upload is left unread, never buffered) and drop the connection once the 413 is out.
      req.off('data', onData)
      req.pause()
      // Give the client a moment to read the 413 first.
      res.once('finish', () => { setTimeout(() => socket.destroy(), CLOSE_GRACE_MS).unref() })
      reject(new BffError(413, 'payload_too_large'))
    }
    req.on('data', onData)
    req.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.once('error', reject)
  })
}

/** The raw JSON text (at most 64 KiB) and its parsed object; anything else is rejected. */
export async function readJsonObject(event: H3Event, invalid: InvalidBody): Promise<{ raw: string; json: Record<string, unknown> }> {
  if (Number(getHeader(event, 'content-length') ?? 0) > MAX_BODY_BYTES) bffFail(413, 'payload_too_large')
  const raw = await readCapped(event)
  if (!raw) bffFail(invalid.status, invalid.code)
  let json: unknown
  try { json = JSON.parse(raw) } catch { return bffFail(invalid.status, invalid.code) }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) bffFail(invalid.status, invalid.code)
  return { raw, json: json as Record<string, unknown> }
}
