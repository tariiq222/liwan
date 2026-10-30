import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FinanceAssetDetailSchema, FinanceAssetListSchema, FinanceAssetProfileListSchema } from '@liwan/contracts'
import { financeAssetsPreviewData } from '../../../../e2e/finance-assets-ui-preview-data.mjs'

// The finance assets pages stay on their templates. This is a source guard, not a behaviour test.
const app = resolve(import.meta.dirname, '../../..')
const locales = resolve(app, '../i18n/locales')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

function sources(dir: string): string[] {
  return readdirSync(resolve(app, dir)).flatMap(name => {
    const path = `${dir}/${name}`
    if (statSync(resolve(app, path)).isDirectory()) return name === '__tests__' ? [] : sources(path)
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

const FILES = [
  ...sources('pages/finance/assets'),
  ...sources('components/finance/assets'),
  'composables/finance/useFinanceAssets.ts',
]

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
}
const locale = (code: string) => JSON.parse(readFileSync(resolve(locales, `${code}/finance-assets.json`), 'utf8')) as Record<string, unknown>

describe('the finance assets pages stay on their templates', () => {
  it.each([
    ['pages/finance/assets/index.vue', ['<SharedListPage', 'v-bind="page"', '#actions', '<AssetComputeButton']],
    ['components/finance/assets/useAssetListPage.ts', ['kpiToggle: true', "kind: 'count'", "can('finance.assets.manage')", 'returnTo']],
    ['components/finance/assets/AssetList.vue', ['<SharedListCard', 'embedded', '<SharedFilterBar', '<SharedDataTable', ' bare', '<SharedRecordNumber', '#mobile-row', '<SharedStatusBadge', '<SharedListFooter', '<SharedPageState', '<SharedEmptyState', '<AssetKpiStrip', 'useKpiVisibility', '<AssetComputeSection']],
    ['components/finance/assets/AssetKpiStrip.vue', ['<SharedKpiStrip']],
    ['components/finance/assets/AssetComputeSection.vue', ['<SharedInlineConfirm', '<SharedDateField', '<UAlert']],
    ['pages/finance/assets/new.vue', ['<SharedCreatePanel', '<SharedForbiddenState', '<AssetList background']],
    ['components/finance/assets/AssetForm.vue', ['<SharedFormSection panel', '<SharedFormActions', '<SharedUnsavedChanges', '<SharedDateField', '<PartnerPicker', 'color="error" variant="subtle"', ':error=']],
    ['pages/finance/assets/[id].vue', ['<SharedRecordPage', '#aside', '#actions']],
    ['components/finance/assets/useAssetRecord.ts', ["kind: 'category'", 'statusTag(', 'readFinanceActions(']],
    ['components/finance/assets/AssetRecordActions.vue', ['finance-asset-validate', 'finance-asset-edit', '<SharedRowActions']],
    ['components/finance/assets/AssetRecordBody.vue', ['<AssetForm', '<SharedInlineConfirm', '<FinanceBlockedNotice']],
    ['components/finance/assets/AssetRecordBody.vue', ['<SharedInlineConfirm', '<UAlert', 'variant="tinted"']],
    ['components/finance/assets/AssetRecordAside.vue', ['<SharedPropertiesPanel', '<SharedPropertyRow']],
    ['components/finance/assets/AssetBoardPanel.vue', ['<SharedDataTable', ' bare', '#mobile-row', '<SharedStatusBadge']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
  })

  it('draws no hand-made table, skeleton, badge or physical-direction class', () => {
    for (const file of FILES) {
      const source = read(file)
      expect(source, file).not.toMatch(/<UTable\b/)
      expect(source, file).not.toMatch(/<USkeleton\b/)
      expect(source, file).not.toMatch(/v-html/)
      expect(source, file).not.toMatch(/<style\b/)
      expect(source, file).not.toMatch(/md:hidden/)
      expect(source, file).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/)
      expect(source, file).not.toMatch(/rounded-(md|lg|xl|\[)/)
      expect(file, file).not.toMatch(/Badge\.vue$/)
    }
  })

  it('gates every write control behind its capability', () => {
    expect(read('components/finance/assets/useAssetCreatePage.ts')).toContain("can('finance.assets.manage')")
    expect(read('components/finance/assets/useAssetCompute.ts')).toContain("can('finance.assets.manage')")
    expect(read('components/finance/assets/AssetList.vue')).toContain("can('finance.assets.read')")
  })
})

describe('the finance assets locale', () => {
  it('has the same keys in Arabic and English', () => {
    expect(leafKeys(locale('en')).sort()).toEqual(leafKeys(locale('ar')).sort())
  })

  it('has no unused key and no missing key', () => {
    const source = FILES.map(read).join('\n')
    const keys = leafKeys(locale('ar')).map(key => key.replace(/^financeAssets\./, ''))
    const used = (key: string) => {
      const parent = key.split('.').slice(0, -1).join('.')
      return source.includes(`financeAssets.${key}`) || source.includes(`financeAssets.${parent}.\${`)
    }
    expect(keys.filter(key => !used(key))).toEqual([])
    const literal = [...source.matchAll(/financeAssets\.([A-Za-z.]+[A-Za-z])['`"]/g)].map(match => match[1]!)
    expect(literal.filter(key => !keys.includes(key))).toEqual([])
  })
})

describe('the assets preview data', () => {
  const serve = (path: string, search = '') => financeAssetsPreviewData(path, new URL(`http://mock${path}${search}`))
  const all = (path: string, search = '') => serve(path, search) as { items: Array<{ id: number }>; total: number }

  it('serves profiles, assets and details that satisfy the contracts', () => {
    expect(FinanceAssetProfileListSchema.parse(all('/api/v1/finance/asset-profiles')).total).toBe(3)
    const assets = FinanceAssetListSchema.parse(all('/api/v1/finance/assets', '?limit=100'))
    expect(assets.total).toBe(8)
    for (const { id } of assets.items) FinanceAssetDetailSchema.parse(serve(`/api/v1/finance/assets/${id}`))
  })

  it('keeps every board consistent with its asset', () => {
    for (const { id } of all('/api/v1/finance/assets', '?limit=100').items) {
      const asset = FinanceAssetDetailSchema.parse(serve(`/api/v1/finance/assets/${id}`))
      const posted = asset.lines.filter(line => line.posted && line.type === 'depreciate')
      expect(posted.reduce((sum, line) => sum + line.amount, 0)).toBeCloseTo(asset.value_depreciated, 2)
      if (asset.state === 'draft') expect(asset.lines.every(line => !line.posted)).toBe(true)
      expect(asset.lines.every(line => (line.entry !== null) === (line.posted && line.type !== 'create'))).toBe(true)
    }
  })

  it('reports the filtered total, not the page size', () => {
    expect(all('/api/v1/finance/assets', '?state=draft&limit=1')).toMatchObject({ total: 2, items: [{ id: 4 }] })
    expect(all('/api/v1/finance/assets', '?profile_id=1').total).toBe(4)
    expect(all('/api/v1/finance/assets', '?q=ast-003').total).toBe(1)
  })
})
