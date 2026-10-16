import { describe, expect, it } from 'vitest'
import { packageHttp } from '../package-http.js'

const pool = { query: async () => { throw new Error('a retired write must not reach the database') } } as never
const base = { repositoryRoot: '/repo', raw: '{}', actor: 7, stepUpFresh: true }

describe('Track A packages are read-only history (owner decision O1)', () => {
  it.each([
    ['POST', '/v1/packages'],
    ['PATCH', '/v1/packages/11111111-1111-4111-8111-111111111111'],
    ['DELETE', '/v1/packages/11111111-1111-4111-8111-111111111111'],
    ['POST', '/v1/packages/11111111-1111-4111-8111-111111111111/validate'],
    ['POST', '/v1/packages/11111111-1111-4111-8111-111111111111/publish'],
    ['POST', '/v1/packages/11111111-1111-4111-8111-111111111111/restore'],
    ['POST', '/v1/packages/11111111-1111-4111-8111-111111111111/withdraw'],
    ['POST', '/v1/packages/11111111-1111-4111-8111-111111111111/revisions'],
  ])('%s %s answers 410 packages_retired', async (method, pathname) => {
    await expect(packageHttp(pool, { ...base, method, pathname, capabilities: ['vendor.catalog.manage'] })).rejects.toMatchObject({ status: 410, code: 'packages_retired' })
  })
  it('still checks the capability first', async () => {
    await expect(packageHttp(pool, { ...base, method: 'POST', pathname: '/v1/packages', capabilities: ['vendor.read'] })).rejects.toMatchObject({ status: 403 })
  })
})
