import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FinanceAuditEventListSchema, FinanceClosingPreviewSchema, FinanceFiscalYearListSchema, FinanceZatcaStatusSchema,
} from '@liwan/contracts'
import { financeGovernancePreviewData } from '../../../../e2e/finance-governance-ui-preview-data.mjs'

// The finance governance settings pages stay on their templates. This is a source guard, not a behaviour test.
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

const PAGES = ['pages/settings/apps/finance/index.vue', 'pages/settings/apps/finance/audit.vue']
const FILES = [
  ...PAGES,
  ...sources('components/finance/governance'),
  'composables/finance/useFinanceClosing.ts',
  'composables/finance/useFinanceZatca.ts',
  'composables/finance/useFinanceAudit.ts',
]

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
}
const locale = (code: string) => JSON.parse(readFileSync(resolve(locales, `${code}/finance-governance.json`), 'utf8')) as Record<string, unknown>

describe('the finance governance pages stay on their templates', () => {
  it.each([
    ['pages/settings/apps/finance/index.vue', ['<ClosingView', 'id="closing"', "shows('closing')", '<ZatcaView', 'id="zatca"', "shows('zatca')", '<SettingsPreviewCard', '<AuditPreview', "shows('audit')"]],
    ['components/finance/governance/AuditPreview.vue', ['<SettingsPreviewList', "can('finance.audit.read')"]],
    ['pages/settings/apps/finance/audit.vue', ['<SharedSettingsPage', '<SharedPageHeader', "kind: 'count'"]],
    ['components/finance/governance/ClosingYears.vue', ['<SharedRecordSection', '<SharedDataTable', ' bare', '#mobile-row', '<SharedStatusBadge']],
    ['components/finance/governance/ClosingPreview.vue', ['variant="action"', '<SharedInlineConfirm', 'color="error" variant="subtle"', '<SharedDataTable', ' bare', '#mobile-row', "can('finance.closing.manage')", "can('finance.setup.manage')"]],
    ['components/finance/governance/ZatcaBacklog.vue', ['<SharedMetricTile', 'density="compact"']],
    ['components/finance/governance/ZatcaWorkList.vue', ['<SharedRecordSection', '<SharedDataTable', ' bare', '#mobile-row', '<SharedListFooter', '<SharedPageState', '<SharedEmptyState', "can('finance.zatca.read')"]],
    ['components/finance/governance/ZatcaJournals.vue', ['<SharedStatusBadge', "can('finance.zatca.manage')"]],
    ['components/finance/governance/ZatcaOnboardForm.vue', ['inputmode="numeric"', '<SharedInlineConfirm', 'color="error" variant="subtle"', "can('finance.zatca.manage')"]],
    ['components/finance/governance/AuditList.vue', ['<SharedListCard', 'embedded', '<SharedFilterBar', '<SharedDateField', '<SharedDataTable', ' bare', '#mobile-row', '<SharedListFooter', '<SharedPageState', '<SharedEmptyState', 'useRouteListFilters', "can('finance.audit.read')"]],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
  })

  it('keeps the close button in view but disabled while something blocks the close, and shows no raw server text under a blocker', () => {
    const source = read('components/finance/governance/ClosingPreview.vue')
    expect(source).toContain('confirming || blocked')
    expect(source).toContain('finance-closing-blocked-hint')
    expect(source).not.toMatch(/blocker\.message/)
    expect(source).not.toContain('blockers.value.length === 0')
  })

  it('shows no KPI strip on a settings page', () => {
    for (const file of FILES) expect(read(file), file).not.toMatch(/SharedKpiStrip|kpiToggle/)
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
      expect(source, file).not.toMatch(/confirm\(/)
      expect(file, file).not.toMatch(/Badge\.vue$/)
    }
  })
})

describe('the finance governance locale', () => {
  it('has the same keys in Arabic and English', () => {
    expect(leafKeys(locale('en')).sort()).toEqual(leafKeys(locale('ar')).sort())
  })

  it('has no unused key and no missing key', () => {
    const source = FILES.map(read).join('\n')
    const keys = leafKeys(locale('ar')).map(key => key.replace(/^financeGovernance\./, ''))
    const used = (key: string) => {
      const parent = key.split('.').slice(0, -1).join('.')
      return source.includes(`financeGovernance.${key}`) || source.includes(`financeGovernance.${parent}.\${`)
    }
    expect(keys.filter(key => !used(key))).toEqual([])
    const literal = [...source.matchAll(/financeGovernance\.([A-Za-z.]+[A-Za-z])['`"]/g)].map(match => match[1]!)
    expect(literal.filter(key => !keys.includes(key))).toEqual([])
  })
})

describe('the governance preview data', () => {
  const serve = (path: string, search = '') => financeGovernancePreviewData(path, new URL(`http://mock${path}${search}`))
  const audit = (search = '') => serve('/api/v1/finance/audit-events', search) as { items: Array<{ action: string }>; total: number }

  it('serves fiscal years with an open year that is clean and one that is blocked', () => {
    const years = FinanceFiscalYearListSchema.parse(serve('/api/v1/finance/fiscal-years'))
    expect(years.items.map(item => item.state)).toEqual(['closed', 'open', 'open'])
    for (const { year } of years.items.filter(item => item.state === 'open')) {
      const preview = FinanceClosingPreviewSchema.parse(serve(`/api/v1/finance/fiscal-years/${year}/closing-preview`))
      expect(preview.total_debit).toBe(preview.total_credit)
    }
    expect(serve('/api/v1/finance/fiscal-years/2025/closing-preview')).toMatchObject({ blockers: [] })
    expect(serve('/api/v1/finance/fiscal-years/2026/closing-preview')).toMatchObject({ blockers: [{ code: 'year_not_ended' }] })
    expect(serve('/api/v1/finance/fiscal-years/2024/closing-preview')).toBeUndefined()
  })

  it('serves a sandbox ZATCA status with an onboarded and a not onboarded journal and a backlog', () => {
    const status = FinanceZatcaStatusSchema.parse(serve('/api/v1/finance/zatca/status'))
    expect(status.api_mode).toBe('sandbox')
    expect(status.journals.some(item => item.onboarded)).toBe(true)
    expect(status.journals.some(item => !item.onboarded)).toBe(true)
    expect(Object.values(status.backlog).some(count => count > 0)).toBe(true)
  })

  it('serves audit events of every action and reports the filtered total, not the page size', () => {
    const all = FinanceAuditEventListSchema.parse(audit('?limit=100'))
    expect(all.total).toBe(30)
    expect(new Set(all.items.map(item => item.action)).size).toBe(5)
    expect(audit('?action=zatca_onboarded&limit=1')).toMatchObject({ total: 5, items: [{ action: 'zatca_onboarded' }] })
    expect(audit('?limit=10&offset=25').items).toHaveLength(5)
    expect(audit('?date_from=2999-01-01').total).toBe(0)
  })
})
