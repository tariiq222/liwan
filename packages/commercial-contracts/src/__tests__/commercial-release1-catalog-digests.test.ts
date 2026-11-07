import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { catalogApplicationsFromSolution, catalogDigest, normalizeRelease } from '../commercial/catalog.js'
import type { CatalogRelease } from '../commercial/types.js'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../../deploy/catalog/solutions/${name}`, import.meta.url), 'utf8'))
const releaseOf = (name: string): CatalogRelease => ({
  id: '00000000-0000-4000-8000-000000000001', version: name, source_digest: 'a'.repeat(64), artifact_digest: 'b'.repeat(64),
  applications: catalogApplicationsFromSolution(read(name), name),
})

/**
 * A6: a catalog's artifact digest is what a published release is pinned by. These three digests are exactly what
 * `origin/main` produced before release 1, so `sellable` being added must never move them. `platform_v4.json` is the
 * current release and is expected to differ; the fix is that nothing else does.
 *
 * If one of these fails, a catalog that a tenant is already pinned to changed shape. Do not update the value: fix the
 * derivation, or add the new catalog as a new file.
 */
describe('release 1 leaves every earlier catalog digest untouched', () => {
  it.each([
    ['platform.json', 'e80744d7ded91eb3ef492a8e5284a5e2d565a991081e03370846eca99ec7535b'],
    ['platform_v2.json', '6c409683f7ecd73210114c46b0ccfcc8c93affafdea0759b51d76180e999f712'],
    ['platform_v3.json', '506362b6bca96f78920462c9888fe54a01fb06a3f88f44919d56d531483a3de3'],
  ])('%s keeps its pinned artifact digest', (name, digest) => {
    expect(catalogDigest(releaseOf(name))).toBe(digest)
  })

  it('emits sellable only where the catalog declares it', () => {
    for (const name of ['platform.json', 'platform_v2.json', 'platform_v3.json']) {
      const applications = releaseOf(name).applications
      expect(applications.every(app => !Object.hasOwn(normalizeRelease(releaseOf(name)).applications.find(a => a.id === app.id)!, 'sellable')), name).toBe(true)
    }
    // The current release names what it sells, so the flag reaches the artifact there.
    expect(releaseOf('platform_v4.json').applications.filter(app => app.sellable).map(app => app.id)).toEqual(['crm', 'inbox'])
  })

  it('treats a tier that declares nothing as not for sale', () => {
    // platform_v3 is schema 3 but predates the flag: nothing in it may be sold, which is why it is not publishable.
    expect(releaseOf('platform_v3.json').applications.some(app => app.sellable)).toBe(false)
  })
})
