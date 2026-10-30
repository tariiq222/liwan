import type { Pool, PoolClient } from 'pg'
import type { VendorCapability, VendorRole } from '@liwan/commercial-contracts'
import { capabilitiesFor, rolesGranting } from './roles.js'

// A vendor actor is a vendor account: its authority is always computed from vendor_account_roles and
// vendor_accounts.status. There is no stored copy to keep in sync, so a disabled account or a removed
// role loses authority at the next recheck.
const VENDOR_ISSUER_SUFFIX = ':vendor-account'
export type Actor = { issuer: string; actorUid: number }
type Db = Pick<Pool | PoolClient, 'query'>

/** The issuer written on every row a vendor account acts on; system actors (commercial fulfilment, migration) never carry it. */
export const vendorActorIssuer = (installationId: string): string => `${installationId}${VENDOR_ISSUER_SUFFIX}`
export const isVendorActor = (actor: { issuer: string }): boolean => actor.issuer.endsWith(VENDOR_ISSUER_SUFFIX)
/** One audit/actor spelling for a vendor account (`account:<id>`); system actors keep `issuer:uid`. */
export const actorLabel = (actor: Actor): string => isVendorActor(actor) ? `account:${actor.actorUid}` : `${actor.issuer}:${actor.actorUid}`

/** Capabilities of an active account, or null when the account is missing or not active. `lock` pins the account row until commit. */
export async function accountCapabilities(db: Db, accountId: number, lock = false): Promise<VendorCapability[] | null> {
  const account = await db.query(`SELECT 1 FROM vendor_accounts WHERE id=$1 AND status='active'${lock ? ' FOR SHARE' : ''}`, [accountId])
  if (!account.rowCount) return null
  const roles = await db.query('SELECT role FROM vendor_account_roles WHERE account_id=$1', [accountId])
  return capabilitiesFor(roles.rows.map((r) => r.role as VendorRole))
}

/** True when the actor is a vendor account that is active right now and holds every capability. */
export async function actorHolds(db: Db, actor: Actor, required: readonly VendorCapability[], lock = false): Promise<boolean> {
  if (!isVendorActor(actor) || !Number.isSafeInteger(actor.actorUid) || actor.actorUid < 1) return false
  const held = await accountCapabilities(db, actor.actorUid, lock)
  return held !== null && required.every((capability) => held.includes(capability))
}

/** The same rule as actorHolds as one SQL condition over row columns (internal constants only, never input). */
export function actorHoldsSql(issuerColumn: string, uidColumn: string, required: readonly VendorCapability[]): string {
  const held = required.map((capability) => `EXISTS (SELECT 1 FROM vendor_account_roles r JOIN vendor_accounts a ON a.id=r.account_id
      WHERE a.id=${uidColumn} AND a.status='active' AND r.role = ANY(ARRAY[${rolesGranting(capability).map((role) => `'${role}'`).join(',')}]::text[]))`)
  return `(${issuerColumn} LIKE '%${VENDOR_ISSUER_SUFFIX}' AND ${held.join(' AND ')})`
}
