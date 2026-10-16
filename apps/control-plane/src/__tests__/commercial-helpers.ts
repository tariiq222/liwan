import { Pool } from 'pg'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { migrate } from '../db.js'
import { commercialHttp } from '../commercial/http.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'

export const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) { const p = new URL(url); if (!['127.0.0.1', 'localhost', '::1'].includes(p.hostname) || !/^webvue_control_scratch_[a-z0-9]+$/.test(p.pathname.slice(1))) throw Error('scratch control DB required') }
export const ALL = ['vendor.read', 'vendor.catalog.manage', 'vendor.pricing.manage'] as any[]
export async function setup(pool: Pool) {
  await migrate(pool)
  const raw = await readFile(new URL('../../../../deploy/catalog/solutions/platform.json', import.meta.url))
  const version = `commercial-${randomUUID()}`
  await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)", [randomUUID(), version, JSON.parse(raw.toString()), createHash('sha256').update(raw).digest('hex')])
  return { version, solution: JSON.parse(raw.toString()) }
}
export function client(pool: Pool, caps: any[] = ALL, issuer = 'commercial-test') {
  return async (method: string, path: string, body?: unknown) => {
    const [pathname, search] = path.split('?')
    try {
      const r = await commercialHttp(pool, { method, pathname: `/v1/commercial${pathname}`, search: search ? `?${search}` : '', raw: body === undefined ? '' : JSON.stringify(body), issuer, actor: 7, capabilities: caps, stepUpFresh: true })
      return { status: r!.status, body: r!.data as any }
    } catch (e) {
      if (e instanceof CommercialHttpError) return { status: e.status, body: { code: e.code, field: e.field, issues: e.issues } as any }
      throw e
    }
  }
}
export const money = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
export const monthly = { unit: 'month' as const, count: 1 }
