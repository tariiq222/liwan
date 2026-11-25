import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const page = (p: string) => readFileSync(resolve(root, `app/pages/${p}`), 'utf8')

describe('/catalog: the offer as it stands', () => {
  const src = page('catalog/index.vue')

  it('shows the applications of the current version: the published one, else the newest import', () => {
    expect(src).toContain('currentCatalogVersion(data.value ?? [])')
    expect(src).toContain('version.value?.solution.tiers ?? []')
    expect(src).toContain(':rows="apps"')
    expect(src).toContain(':caption="t(\'vendor.catalog.applications\')"')
  })

  it('says the offer is only an import when the current version is not published', () => {
    expect(src).toContain("version.status !== 'published'")
    expect(src).toContain('data-testid="catalog-not-published"')
    expect(src).toContain('vendor.catalog.notPublishedTitle')
    expect(src).toContain('to="/catalog/releases"')
  })

  it('links every application to its record and marks the sellable ones, never core', () => {
    expect(src).toContain('/catalog/apps/${encodeURIComponent(tier.id)}')
    expect(src).toContain("tier.id !== 'core'")
    expect(src).toContain('data-testid="catalog-app-sellable"')
    expect(src).toContain('vendor.catalog.sellableApps')
  })
})

describe('/catalog/releases: a version with no step', () => {
  const list = page('catalog/releases/index.vue')
  const record = page('catalog/releases/[id].vue')

  it('offers the approve link only to a validated row', () => {
    expect(list).toContain("version.status === 'validated'")
    expect(list).not.toContain('<NuxtLink v-else :to="path(version)" data-testid="catalog-approve"')
  })

  it('says a legacy draft has to be imported again, on the list and on the record, with no action', () => {
    expect(list).toContain('legacyDraft(version.status)')
    expect(list).toContain("t('vendor.catalog.legacyDraft')")
    expect(record).toContain('legacyDraft(version.status)')
    expect(record).toContain("t('vendor.catalog.legacyDraft')")
  })
})

describe('/catalog/apps/[app]: one application', () => {
  const src = page('catalog/apps/[app].vue')

  it('renders the features section with each descriptor and its ceiling', () => {
    expect(src).toContain('data-testid="catalog-app-features"')
    expect(src).toContain('vendor.catalog.app.featuresTitle')
    expect(src).toContain('data-testid="catalog-app-feature"')
    expect(src).toContain('parseFeature(raw)')
    expect(src).toContain('vendor.catalog.app.featureCeiling')
    expect(src).toContain('vendor.catalog.app.featureBoolean')
    expect(src).toContain('vendor.catalog.app.featureLimit')
  })

  it('renders the pricing section from the bundles and plans that use the application', () => {
    expect(src).toContain('data-testid="catalog-app-pricing"')
    expect(src).toContain('vendor.catalog.app.pricing')
    expect(src).toContain('bundlesWithApp(page => api.listBundles(page), appId.value)')
    expect(src).toContain('plansUsingBundles(page => api.listPlans(page), bundles.map(bundle => bundle.id))')
    expect(src).toContain('data-testid="catalog-app-bundle-link"')
    expect(src).toContain('data-testid="catalog-app-plan-link"')
  })

  it('reads the record from the versions and releases only, never the audit endpoint', () => {
    expect(src).toContain("definePageMeta({ capability: 'vendor.read' })")
    expect(src).toContain('useVendorCatalogVersions().load()')
    expect(src).toContain('api.releases()')
    expect(src).not.toMatch(/audit/i)
  })
})
