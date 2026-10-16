import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { CommercialError } from '@webvue/commercial-contracts/server'
import { canonicalJson, type CommercialIssue } from '@webvue/commercial-contracts'
import { transaction } from '../db.js'
import { actorLabel } from '../admin-auth/grants.js'

export type CommercialActor = { issuer: string; actorUid: number }
export class CommercialHttpError extends Error {
  constructor(public code: string, public status: number, public field?: string, public issues: CommercialIssue[] = []) { super(code) }
}
export const toIssue = (e: unknown): CommercialIssue => {
  if (e instanceof CommercialError) return e.field ? { code: e.code, field: e.field } : { code: e.code }
  throw e
}
export const digestOf = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
export const iso = (v: unknown) => v instanceof Date ? v.toISOString() : v
export function isoRow(row: Record<string, unknown>) { return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, iso(v)])) }

export async function audit(client: PoolClient, actor: CommercialActor, action: string, subject: string, reason: string, metadata: unknown) {
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), actorLabel(actor), action, subject, reason, JSON.stringify(metadata)])
}

export type Kind = { table: 'bundle_revisions' | 'plan_revisions'; parent: 'commercial_bundles' | 'commercial_plans'; parentCol: 'bundle_id' | 'plan_id'; label: 'bundle' | 'plan' }

/** Locks the revision row and enforces the optimistic edit_revision. */
export async function lockRevision(client: PoolClient, kind: Kind, id: string, editRevision?: number): Promise<Record<string, any>> {
  const r = await client.query(`SELECT * FROM ${kind.table} WHERE id=$1 FOR UPDATE`, [id])
  if (!r.rowCount) throw new CommercialHttpError(`${kind.label}_missing`, 404)
  const row = r.rows[0]
  if (editRevision !== undefined && row.edit_revision !== editRevision) throw new CommercialHttpError('revision_conflict', 409)
  return row
}
export function requireStatus(row: Record<string, any>, allowed: string[]) {
  if (!allowed.includes(row.status)) throw new CommercialHttpError('transition_invalid', 409)
}
export async function referenceCount(client: Pool | PoolClient, id: string): Promise<number> {
  const r = await client.query('SELECT count(*)::int AS n FROM revision_references WHERE revision_id=$1', [id])
  return r.rows[0].n
}
export async function nextVersion(client: PoolClient, kind: Kind, parentId: string): Promise<number> {
  await client.query(`SELECT id FROM ${kind.parent} WHERE id=$1 FOR UPDATE`, [parentId])
  const n = await client.query(`UPDATE ${kind.parent} SET next_version=next_version+1 WHERE id=$1 RETURNING next_version-1 AS version`, [parentId])
  return n.rows[0].version
}
export function pageParams(url: URL) {
  const num = (name: string, def: number, max: number) => {
    const raw = url.searchParams.get(name)
    if (raw === null) return def
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0 || n > max) throw new CommercialHttpError('invalid', 422, name)
    return n
  }
  const status = url.searchParams.get('status') ?? 'all'
  if (!['draft', 'validated', 'published', 'withdrawn', 'all'].includes(status)) throw new CommercialHttpError('invalid', 422, 'status')
  return { status, q: (url.searchParams.get('q') ?? '').trim().toLowerCase(), limit: Math.max(1, num('limit', 50, 200)), offset: num('offset', 0, 1_000_000) }
}
export function statusSql(status: string): string {
  return ({ draft: "status='draft'", validated: "status='validated'", published: "status='published' AND available", withdrawn: "status='published' AND NOT available", all: 'true' } as Record<string, string>)[status]!
}
export const run = transaction
