// Mock-only first-paint fixtures. The ordinary mock session keeps its defaults;
// each spec gets an opaque session so concurrent contexts cannot replace its data.
import { randomUUID } from 'node:crypto'
import { myTaskFixtureRead } from './my-tasks-fixtures.mjs'

const fixtures = new Map()
export const fixtureSession = req => /(?:^|;\s*)session_id=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]
export const hasFixtureSession = req => fixtures.has(fixtureSession(req))

export async function handleSsrFixtures(req, res, path, url, { json, readBody, session }) {
  const id = fixtureSession(req)
  if (path === '/api/v1/__mock/ssr-fixture') {
    if (req.method === 'PUT') {
      const data = JSON.parse(await readBody(req) || '{}')
      const scoped = fixtures.has(id) ? id : `liwan-ssr-${randomUUID()}`
      fixtures.set(scoped, data)
      json(res, 200, { ok: true }, { 'set-cookie': `session_id=${scoped}; Path=/; HttpOnly; SameSite=Lax` })
      return true
    }
    if (req.method === 'DELETE') {
      fixtures.delete(id)
      json(res, 200, { ok: true }, { 'set-cookie': `session_id=${session}; Path=/; HttpOnly; SameSite=Lax` })
      return true
    }
  }
  if (req.method !== 'GET') return false
  const data = fixtures.get(id)
  const body = data?.reads?.[path] ?? myTaskFixtureRead(url, data?.myTasks)
  if (body === undefined) return false
  json(res, 200, body)
  return true
}
