import type { Pool } from 'pg'
import { z } from 'zod'
import type { VendorCapability } from '@nasq/commercial-contracts'
import { transaction } from '../db.js'
import { AdminAuthError, disableAccount, lockOwners, requireActingOwner, setRoles } from './accounts.js'
import { hashToken } from './crypto.js'
import { inviteAccount, issueReset } from './enrollment.js'
import { VENDOR_ROLES } from './roles.js'

const reason = z.string().min(3).max(1000)
const roles = z.array(z.enum(VENDOR_ROLES)).min(1).max(VENDOR_ROLES.length)
const inviteBody = z.object({ email: z.string().min(3).max(254), display_name: z.string().min(1).max(120), roles, reason }).strict()
const rolesBody = z.object({ roles, reason }).strict()
const reasonBody = z.object({ reason }).strict()

type Auth = { actor: number; capabilities: VendorCapability[]; stepUpFresh: boolean; method: string }
type Input = { method: string; pathname: string; raw: string; auth: Auth; requireCapability: (auth: Auth, capability: VendorCapability) => void; fail: (status: number, code: string) => Error }
type Result = { status: number; data?: unknown }

function body<T extends z.ZodType>(schema: T, raw: string, fail: Input['fail']): z.infer<T> {
  let json: unknown
  try { json = JSON.parse(raw) } catch { throw fail(422, 'invalid') }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw fail(422, 'invalid')
  return parsed.data
}

/** Returns null when the route is outside the account-management resource. */
export async function accountsHttp(pool: Pool, input: Input): Promise<Result | null> {
  const { method, pathname, auth } = input
  const isMe = pathname === '/v1/admin/me'
  const isList = pathname === '/v1/admin/accounts'
  const action = /^\/v1\/admin\/accounts\/([1-9][0-9]{0,15})\/(roles|disable|reset)$/.exec(pathname)
  if (!isMe && !isList && !action) return null
  try {
    if (isMe) {
      if (method !== 'GET') throw input.fail(404, 'not_found')
      const row = (await pool.query('SELECT a.id, a.email, a.display_name, COALESCE((SELECT array_agg(role ORDER BY role) FROM vendor_account_roles WHERE account_id=a.id), \'{}\') AS roles FROM vendor_accounts a WHERE a.id=$1', [auth.actor])).rows[0]
      if (!row) throw input.fail(401, 'unauthorized')
      return { status: 200, data: { id: Number(row.id), email: row.email, display_name: row.display_name, roles: row.roles, capabilities: auth.capabilities } }
    }
    input.requireCapability(auth, 'vendor.accounts.manage')
    const now = new Date()
    if (isList) {
      if (method === 'GET') {
        const rows = (await pool.query(`SELECT a.id, a.email, a.display_name, a.status,
          COALESCE((SELECT array_agg(role ORDER BY role) FROM vendor_account_roles WHERE account_id=a.id), '{}') AS roles,
          (SELECT count(*) FROM vendor_passkeys WHERE account_id=a.id) AS passkeys,
          (SELECT max(last_seen_at) FROM vendor_sessions WHERE account_id=a.id) AS last_seen_at
          FROM vendor_accounts a ORDER BY a.id`)).rows
        const items = rows.map((r) => ({ id: Number(r.id), email: r.email, display_name: r.display_name, status: r.status, roles: r.roles, passkeys: Number(r.passkeys), last_seen_at: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null }))
        return { status: 200, data: { items, total: items.length } }
      }
      if (method !== 'POST') throw input.fail(404, 'not_found')
      const b = body(inviteBody, input.raw, input.fail)
      const invited = await transaction(pool, async (c) => {
        const result = await inviteAccount(c, { id: auth.actor }, { email: b.email, displayName: b.display_name, roles: b.roles, reason: b.reason }, now)
        const row = await c.query('SELECT account_id FROM vendor_invitations WHERE token_hash=$1', [hashToken(result.token)])
        return { ...result, accountId: Number(row.rows[0].account_id) }
      })
      return { status: 201, data: { id: invited.accountId, invitation_token: invited.token, expires_at: invited.expiresAt.toISOString() } }
    }
    if (method !== 'POST') throw input.fail(404, 'not_found')
    const id = Number(action![1])
    if (action![2] === 'roles') {
      const b = body(rolesBody, input.raw, input.fail)
      await transaction(pool, (c) => setRoles(c, { id: auth.actor }, id, b.roles, b.reason))
      return { status: 204 }
    }
    if (action![2] === 'disable') {
      const b = body(reasonBody, input.raw, input.fail)
      await transaction(pool, (c) => disableAccount(c, { id: auth.actor }, id, b.reason))
      return { status: 204 }
    }
    const b = body(reasonBody, input.raw, input.fail)
    const reset = await transaction(pool, async (c) => {
      requireActingOwner({ id: auth.actor }, await lockOwners(c))
      return issueReset(c, { id: auth.actor }, id, b.reason, now)
    })
    return { status: 200, data: { invitation_token: reset.token, expires_at: reset.expiresAt.toISOString() } }
  } catch (error) {
    if (error instanceof AdminAuthError) throw input.fail(error.status, error.code)
    throw error
  }
}
