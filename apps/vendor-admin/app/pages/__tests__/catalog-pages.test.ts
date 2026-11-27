import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cadenceLabel, formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { mountPage, type Captured } from '../../__tests__/pageHarness'
import { actionBlockedReason, isEditable, lifecycleBadge, limitLabel } from '../../utils/vendorCommercial'
import { catalogDiff, parseFeature } from '../../utils/catalogDiff'
import { catalogLabel, tierLabel } from '../../utils/catalogLabels'
import { bundlesWithApp, plansUsingBundles } from '../../utils/vendorCatalog'
import { currentCatalogVersion } from '../../utils/vendorCatalogVersions'
import { formatBusinessDate } from '../../utils/vendorTime'

const root = resolve(import.meta.dirname, '../../..')
const page = (p: string) => readFileSync(resolve(root, `app/pages/${p}`), 'utf8')
const component = (p: string) => readFileSync(resolve(root, `app/components/${p}`), 'utf8')
// The records of the mock control plane (e2e/commercial-fixtures.json): its published version `cat-1` offers pmo and
// hr, and each has one add-on revision, a published one for pmo and a draft for hr.
const fixtures = JSON.parse(readFileSync(resolve(root, 'e2e/commercial-fixtures.json'), 'utf8'))

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

  it('offers no publish or validate action on the list or the record', () => {
    for (const src of [list, record]) {
      expect(src).not.toContain('<VendorCatalogVersionAction')
      expect(src).not.toContain('catalog-approve')
      expect(src).not.toContain("t('vendor.catalog.timeline.approve')")
    }
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

  it('links to /addons routes instead of /bundles', () => {
    expect(src).toContain("path: '/addons/new'")
    expect(src).toContain('/addons/${encodeURIComponent(bundle.id)}')
    expect(src).not.toMatch(/['"`]\/bundles\b/)
  })

  it('wires the inline VendorAppPricingEditor', () => {
    expect(src).toContain('data-testid="catalog-app-settings"')
    expect(src).toContain('useHydrated()')
    expect(src).toContain(':disabled="addonsUnavailable || !hydrated || editorBusy"')
    expect(src).toContain('<VendorAppPricingEditor')
    expect(src).toContain('@busy="editorBusy = $event"')
    expect(src).toContain('@working-draft="workingDraftCreated = $event !== null"')
    expect(src).toContain('onPricingCancel(workingDraftCreated.value)')
  })
})

describe('VendorAppPricingEditor: inline pricing and capability gating', () => {
  const editor = component('vendor/AppPricingEditor.vue')

  it('stays inline with shared form primitives and no modal or slideover', () => {
    expect(editor).toContain('data-testid="catalog-app-pricing-editor"')
    expect(editor).toContain('data-testid="catalog-app-pricing-reason"')
    expect(editor).toContain('data-testid="catalog-app-pricing-submit"')
    expect(editor).toContain('data-testid="issues"')
    expect(editor).toContain('<SharedUnsavedChanges')
    expect(editor).toContain('<VendorPriceListEditor')
    expect(editor).toContain('<VendorCapacityLimitsEditor')
    expect(editor).toContain('publishAddonPricing')
    expect(editor).toContain('vendor.pricing.errors.revision_conflict')
    expect(editor).not.toMatch(/<U(?:Modal|Slideover)\b/)
    expect(editor).not.toContain('<style')
  })

  it('gates publishing on both vendor.catalog.manage and vendor.pricing.manage', () => {
    expect(editor).toContain("actionBlockedReason('bundle', 'publish', can")
    expect(editor).toContain('vendor.pricing.blocked.${blockedReason}')
    expect(actionBlockedReason('bundle', 'publish', () => false)).toBe('catalog')
    expect(actionBlockedReason('bundle', 'publish', cap => cap === 'vendor.catalog.manage')).toBe('pricing')
    expect(actionBlockedReason('bundle', 'publish', cap => cap === 'vendor.pricing.manage')).toBe('catalog')
    expect(actionBlockedReason('bundle', 'publish', () => true)).toBeNull()
  })
})

// The page mounted as the browser runs it: the mock control plane's records stand for the control plane, and each child
// component records what the template hands it, so the editor is driven through the listeners the page wires itself.
const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

async function appPage(options: { hydrated?: boolean, reducedMotion?: boolean } = {}) {
  const params = Vue.reactive({ app: 'pmo' })
  const api = {
    releases: vi.fn(async () => fixtures.releases),
    listBundles: vi.fn(async () => ({ items: fixtures.bundles.items, total: fixtures.bundles.total })),
    listPlans: vi.fn(async () => ({ items: [], total: 0 })),
  }
  const refreshNuxtData = vi.fn(async () => {})
  const page = await mountPage('catalog/apps/[app].vue', {
    isEditable, lifecycleBadge, limitLabel, catalogDiff, parseFeature, catalogLabel, tierLabel, currentCatalogVersion, bundlesWithApp, plansUsingBundles,
    formatBusinessDate, cadenceLabel, formatCommercialMoney,
    useI18n: () => ({ t: (key: string) => key, te: () => false, locale: Vue.ref('en') }),
    useRoute: () => ({ params, fullPath: `/catalog/apps/${params.app}`, query: {} }),
    useHydrated: () => Vue.ref(options.hydrated ?? true),
    useVendorCommercial: () => api,
    useVendorCatalogVersions: () => ({ load: async () => ({ data: Vue.ref(fixtures.catalogVersions.items), error: Vue.ref(null), pending: Vue.ref(false), refresh: vi.fn() }) }),
    refreshNuxtData,
    createError: (error: unknown) => error,
    window: { matchMedia: () => ({ matches: options.reducedMotion ?? false }) },
  })
  mounted.push(page)
  return { page, params, refreshNuxtData }
}

/** What the last render handed the inline editor and the header button: their props and the listeners wired to the page. */
const paint = async (page: Awaited<ReturnType<typeof mountPage>>) => (await page.rendered()).captured
const editorOf = (captured: Captured[]) => captured.find(node => node.name === 'VendorAppPricingEditor')?.props
const settingsOf = (captured: Captured[]) => captured.find(node => node.name === 'UButton' && node.props['data-testid'] === 'catalog-app-settings')!.props

describe('/catalog/apps/[app]: the inline pricing editor, mounted', () => {
  it('reads the usage again only when the header button closes an editor that had created a revision', async () => {
    const { page } = await appPage()
    expect(settingsOf(await paint(page)).disabled).toBe(false)

    // Opened and closed with nothing sent: there is nothing new to read.
    await page.state.toggleEditor()
    expect(editorOf(await paint(page))).toBeDefined()
    await settingsOf(await paint(page)).onClick()
    expect(page.state.editorOpen.value).toBe(false)
    expect(editorOf(await paint(page))).toBeUndefined()
    expect(page.state.refreshUsage).not.toHaveBeenCalled()

    // The editor created a revision and the header button closed it: what prices the application is read again.
    await page.state.toggleEditor()
    editorOf(await paint(page))!.onWorkingDraft(fixtures.bundles.items[1])
    expect(page.state.workingDraftCreated.value).toBe(true)
    await settingsOf(await paint(page)).onClick()
    expect(page.state.editorOpen.value).toBe(false)
    expect(page.state.workingDraftCreated.value).toBe(false)
    expect(page.state.refreshUsage).toHaveBeenCalledTimes(1)
    expect(editorOf(await paint(page))).toBeUndefined()
  })

  it('disables the header button while the editor is busy and before hydration, so the editor is never closed in flight', async () => {
    const { page } = await appPage()
    await page.state.toggleEditor()
    editorOf(await paint(page))!.onBusy(true)
    let captured = await paint(page)
    expect(settingsOf(captured).disabled).toBe(true)
    expect(settingsOf(captured)['aria-expanded']).toBe(true)
    expect(editorOf(captured)).toBeDefined()
    // A click that arrives anyway closes nothing: the editor stays mounted until its request settles.
    await settingsOf(captured).onClick()
    expect(page.state.editorOpen.value).toBe(true)
    expect(editorOf(await paint(page))).toBeDefined()
    editorOf(captured)!.onBusy(false)
    expect(settingsOf(await paint(page)).disabled).toBe(false)

    const unhydrated = await appPage({ hydrated: false })
    expect(settingsOf(await paint(unhydrated.page)).disabled).toBe(true)
  })

  it('closes the editor and clears its busy and draft state when the route moves to another application', async () => {
    const { page, params } = await appPage()
    await page.state.toggleEditor()
    let captured = await paint(page)
    editorOf(captured)!.onWorkingDraft(fixtures.bundles.items[1])
    editorOf(captured)!.onBusy(true)
    expect(page.state.editorBusy.value).toBe(true)
    expect(settingsOf(await paint(page)).disabled).toBe(true)

    params.app = 'hr'
    await Vue.nextTick()
    expect(page.state.editorOpen.value).toBe(false)
    expect(page.state.editorBusy.value).toBe(false)
    expect(page.state.workingDraftCreated.value).toBe(false)
    // The usage follows the route, as the page's own watch makes it: the new application's button is free to use.
    await page.state.refreshUsage()
    captured = await paint(page)
    expect(editorOf(captured)).toBeUndefined()
    expect(settingsOf(captured).disabled).toBe(false)
    expect(settingsOf(captured)['aria-expanded']).toBe(false)
  })

  it('scrolls to the opened editor smoothly, or at once for a person who asked for less motion', async () => {
    const anchor = { scrollIntoView: vi.fn() }
    const { page } = await appPage()
    page.state.editorAnchor.value = anchor
    await page.state.toggleEditor()
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })

    const reduced = await appPage({ reducedMotion: true })
    reduced.page.state.editorAnchor.value = anchor
    await reduced.page.state.toggleEditor()
    expect(anchor.scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('closes the editor, clears draft state, and refreshes both Nuxt data and usage on done', async () => {
    const { page, refreshNuxtData } = await appPage()
    await page.state.toggleEditor()
    const editor = editorOf(await paint(page))!
    editor.onWorkingDraft(fixtures.bundles.items[1])
    editor.onBusy(true)
    expect(page.state.workingDraftCreated.value).toBe(true)
    expect(page.state.editorBusy.value).toBe(true)

    await editorOf(await paint(page))!.onDone()
    expect(page.state.editorOpen.value).toBe(false)
    expect(page.state.editorBusy.value).toBe(false)
    expect(page.state.workingDraftCreated.value).toBe(false)
    expect(editorOf(await paint(page))).toBeUndefined()
    expect(refreshNuxtData).toHaveBeenCalledTimes(1)
    expect(page.state.refreshUsage).toHaveBeenCalledTimes(1)
  })

  it('clears draft state and refreshes both Nuxt data and usage on reload while keeping the editor open', async () => {
    const { page, refreshNuxtData } = await appPage()
    await page.state.toggleEditor()
    editorOf(await paint(page))!.onWorkingDraft(fixtures.bundles.items[1])
    expect(page.state.workingDraftCreated.value).toBe(true)

    await editorOf(await paint(page))!.onReload()
    expect(page.state.workingDraftCreated.value).toBe(false)
    expect(page.state.editorOpen.value).toBe(true)
    expect(editorOf(await paint(page))).toBeDefined()
    expect(refreshNuxtData).toHaveBeenCalledTimes(1)
    expect(page.state.refreshUsage).toHaveBeenCalledTimes(1)
  })
})
