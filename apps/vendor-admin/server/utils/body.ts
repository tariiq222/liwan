import { getHeader, readRawBody, type H3Event } from 'h3'
import { bffFail } from './errors'

export const MAX_BODY_BYTES = 1024 * 1024

/** Where a body that is not a JSON object is rejected: the proxy keeps its historic 400, auth routes answer 422. */
export type InvalidBody = { status: number; code: string }
export const PROXY_INVALID: InvalidBody = { status: 400, code: 'invalid_json' }
export const AUTH_INVALID: InvalidBody = { status: 422, code: 'invalid' }

/** The raw JSON text (at most 1 MB) and its parsed object; anything else is rejected. */
export async function readJsonObject(event: H3Event, invalid: InvalidBody): Promise<{ raw: string; json: Record<string, unknown> }> {
  if (Number(getHeader(event, 'content-length') ?? 0) > MAX_BODY_BYTES) bffFail(413, 'payload_too_large')
  const raw = await readRawBody(event, 'utf8')
  if (!raw) bffFail(invalid.status, invalid.code)
  if (Buffer.byteLength(raw as string) > MAX_BODY_BYTES) bffFail(413, 'payload_too_large')
  let json: unknown
  try { json = JSON.parse(raw as string) } catch { return bffFail(invalid.status, invalid.code) }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) bffFail(invalid.status, invalid.code)
  return { raw: raw as string, json: json as Record<string, unknown> }
}
