import { createHmac } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import type { AiUsageProbe } from '@liwan/contracts'
import { tenantRequest } from '../tenantRequest'
import { logFailure, odooServiceUsageJson } from './upstream'

/**
 * The credential the AI usage report carries, derived per tenant database from one deployment secret. `LIWAN_AI_USAGE_KEY` is a
 * root of 64 hex characters held by `web` and `odoo` only; the bearer is `hex(HMAC-SHA256(key = bytes(root), msg = LABEL + "\n" +
 * database))`. Odoo derives the same value for its own database (`odoo-addons/liwan_ai/models/usage_key.py`; a test reads its
 * label), so a bearer made for one database is refused by every other and nothing is stored in a tenant database.
 */
const USAGE_KEY_LABEL = 'liwan-ai-usage/v1'
const ROOT = /^[0-9a-fA-F]{64}$/

/** Logged (class name only) when a run is refused because its usage could not be recorded: no usable root or database, or Odoo refused the probe. */
class UsageRecorderUnavailable extends Error {}

/** How long a healthy answer holds, and how soon a refused tenant is asked again. */
const HEALTHY_FOR_MS = 10 * 60 * 1000
const REFUSED_FOR_MS = 15 * 1000

/** The recorder of one request: its tenant (the database it records into, which keys the spool) and the bearer that database accepts. */
export type UsageRecorder = { tenant: string; bearer: string }

export const usageBearer = (root: string, database: string): string =>
  createHmac('sha256', Buffer.from(root, 'hex')).update(`${USAGE_KEY_LABEL}\n${database}`).digest('hex')

/**
 * The recorder of this request. The database is the tenant's own in a shared deployment (read from the verified registry
 * binding) and `NUXT_ODOO_DB` in a dedicated one. A missing or malformed root, or no database, is the same refusal in every mode.
 * The root is read from the server's own environment on every call, never from runtime config the client could reach.
 */
export function usageRecorder(event: H3Event): UsageRecorder {
  const root = process.env.LIWAN_AI_USAGE_KEY ?? ''
  const database = tenantRequest(event)?.database ?? process.env.NUXT_ODOO_DB ?? ''
  if (!ROOT.test(root) || !database) throw new UsageRecorderUnavailable()
  return { tenant: database, bearer: usageBearer(root, database) }
}

const states = new Map<string, { state: 'healthy' | 'refused'; at: number }>()

/** A report Odoo answered 401 or 403: this tenant's credential is refused now, whatever was cached before. */
export function markUsageRefused(tenant: string): void {
  states.set(tenant, { state: 'refused', at: Date.now() })
}

function unavailable(error: unknown): never {
  logFailure('refused an AI run because its usage cannot be recorded', error)
  throw createError({ statusCode: 503, data: { code: 'ai_unavailable', message: 'the AI usage recorder is unavailable' } })
}

/**
 * Refuses an AI run (503 `ai_unavailable`) whose usage could not be recorded, before the audit row and before any tool runs.
 * The state of a tenant is established by `POST /api/v1/ai/usage/service` with no items: Odoo answers 200 after its credential,
 * feature, capability and identity checks. Healthy is cached for ten minutes, a refused state is asked again after fifteen
 * seconds, and a 401 or 403 on a real report flips it at once (`markUsageRefused`). Returns true when a probe just brought a
 * refused tenant back, so the caller may retry the rows that waited.
 */
export async function assertUsageRecordable(event: H3Event): Promise<boolean> {
  let recorder: UsageRecorder
  try { recorder = usageRecorder(event) } catch (error) { return unavailable(error) }
  const known = states.get(recorder.tenant)
  if (known && Date.now() - known.at < (known.state === 'healthy' ? HEALTHY_FOR_MS : REFUSED_FOR_MS)) {
    if (known.state === 'healthy') return false
    return unavailable(new UsageRecorderUnavailable())
  }
  let status = 0
  try { status = (await odooServiceUsageJson(event, recorder.bearer, { items: [] } satisfies AiUsageProbe)).status } catch { /* an unreachable Odoo is a refused probe */ }
  states.set(recorder.tenant, { state: status === 200 ? 'healthy' : 'refused', at: Date.now() })
  if (status !== 200) return unavailable(new UsageRecorderUnavailable())
  return known?.state === 'refused'
}
