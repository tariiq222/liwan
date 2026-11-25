import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

// Hiding the key figures (`useKpiVisibility`) must stop their requests, not only their drawing: a strip component is
// mounted under `v-if`, and a page that owns its tile queries passes `shown` as their `enabled`.
describe('hidden KPIs ask nothing', () => {
  it.each([
    ['pages/tasks.vue', '<TaskKpiStrip v-if="hydrated && kpisShown"'],
    ['pages/projects/index.vue', '<ProjectKpiStrip v-if="hydrated && kpisShown && !archived"'],
    ['pages/projects/[id]/tasks.vue', '<TaskKpiStrip v-if="kpisShown && !isArchived"'],
    ['pages/operations/index.vue', '<RequestKpiStrip v-if="kpisShown" scope="mine"'],
    ['pages/operations/pending.vue', '<RequestKpiStrip v-if="kpisShown" scope="pending"'],
    ['pages/operations/monitoring.vue', '<RequestKpiStrip v-if="kpisShown" scope="monitoring"'],
    ['pages/hr/insurance.vue', '<InsuranceSummaryStrip v-if="kpisShown && section !== \'plans\'" />'],
  ])('%s mounts its strip only while shown', (file, mount) => {
    expect(read(file)).toContain(mount)
  })

  it.each([
    ['pages/documents.vue', ['const kpiEnabled = computed(() => isListRoute.value && kpisShown.value)', 'useDocuments({ limit: 1 }, kpiEnabled)']],
    // The headcount reuses the directory's own total while it shows the plain active list; it asks only when narrowed.
    ['pages/hr/index.vue', ['useHrEmployees({ limit: 1 }, computed(() => kpisShown.value && !reuseListTotal.value))', 'kpisShown.value && canManage.value']],
    ['components/hr/LeaveList.vue', ['const kpisEnabled = computed(() => !props.personal && isListRoute.value && kpisShown.value)', 'useHrLeaveRequests(kpiQueries.pending, kpisEnabled)', 'useHrLeaveRequests(kpiQueries.approved, kpisEnabled)']],
    // The asset, shift and plan tiles reuse their list's own total while it is unfiltered and ask only when narrowed.
    ['pages/hr/assets.vue', [
      "const kpisEnabled = computed(() => kpisShown.value && can('hr.assets.read'))",
      'useHrEquipmentList({ limit: 1 }, computed(() => kpisEnabled.value && listFiltered.value))',
      'useHrEquipmentList(kpiQueries.assigned, kpisEnabled)',
      'useHrEquipmentList(kpiQueries.available, kpisEnabled)',
    ]],
    ['pages/hr/shifts.vue', [
      'const kpisEnabled = computed(() => canRead.value && kpisShown.value)',
      'useHrShiftSettings(kpisEnabled)',
      'useHrShiftAssignments(computed(() => kpiQueries.value.planned), computed(() => kpisEnabled.value && listFiltered.value))',
      'useHrShiftAssignments(computed(() => kpiQueries.value.today), computed(() => kpisEnabled.value && !!today.value))',
    ]],
    ['pages/hr/insurance.vue', [
      "const plansKpisEnabled = computed(() => kpisShown.value && section.value === 'plans')",
      "useHrInsurancePlans(planKpiQueries.all, computed(() => plansKpisEnabled.value && planState.value !== 'all'))",
      'useHrInsurancePlans(planKpiQueries.active, plansKpisEnabled)',
      'useHrInsurancePlans(planKpiQueries.expired, plansKpisEnabled)',
    ]],
    ['pages/finance/index.vue', ["useFinanceAging('receivable', computed(() => kpisShown.value && canStatements.value))", 'useFinancePartners({ limit: 1 }, computed(() => kpisShown.value && canPartners.value))']],
    ['components/finance/invoices/useInvoiceListPage.ts', ['useFinanceInvoiceSummary(() => invoiceSummaryParams(moveType, filters.value), () => shown.value && allowed.value)']],
    ['components/finance/accounting/useEntryListPage.ts', ['useFinanceEntrySummary(() => entrySummaryParams(filters.value), () => shown.value && allowed.value)']],
    ['components/finance/budgets/useBudgetListPage.ts', ['useFinanceBudgetSummary(() => budgetSummaryParams(filters.value), () => shown.value && allowed.value)']],
    ['components/finance/assets/useAssetListPage.ts', ['useFinanceAssetSummary(() => assetSummaryParams(filters.value), () => shown.value && allowed.value)']],
    // The personal task list moved into the shared workspace when /my-tasks became a redirect (2026-11-21).
    ['components/personal-tasks/MyTasksWorkspace.vue', ['}, kpisShown)']],
    ['pages/meetings/index.vue', ['}), kpisShown)']],
    ['pages/meetings/series.vue', ['useMeetingSeriesKpis(kpisShown)']],
    ['pages/meetings/follow-up.vue', ['}), kpisShown)']],
    ['pages/operations/self/index.vue', ['computed(() => allowed.value && kpisShown.value)']],
    ['pages/customers/index.vue', ['useCustomerKpis(listState, listTotal, computed(() => kpisShown.value && canRead.value))']],
    ['pages/products/index.vue', ['useProductListKpis(listState, listTotal, computed(() => kpisShown.value && canRead.value))']],
    ['pages/sales/index.vue', ['useSalesListKpis(listState, listTotal, computed(() => kpisShown.value && canRead.value))']],
    ['pages/crm/opportunities/index.vue', ['useCrmOpportunityKpis(listFilters, listTotal, computed(() => kpisShown.value && canRead.value), activeView)']],
  ])('%s passes the visibility as the tile queries enabled flag', (file, needles) => {
    const source = read(file)
    expect(source).toContain('useKpiVisibility()')
    for (const needle of needles) expect(source).toContain(needle)
  })

  it('the meetings KPI composables pass enabled to every query', () => {
    const source = read('composables/useMeetingKpis.ts')
    expect(source.match(/\{ enabled \}\)/g)).toHaveLength(4)
    expect(source).toContain('useMeetingSeriesList({ limit: 1 }, enabled)')
    expect(source).toContain("useMeetingFollowup({ state: 'active', limit: 1 }, enabled)")
    expect(source).toContain("useMeetingFollowup({ state: 'overdue', limit: 1 }, enabled)")
    expect(source).toContain('satisfies MeetingFollowupParams), enabled)')
  })

  it('the leave balances keep their error and retry while the tiles are hidden', () => {
    const source = read('components/hr/LeaveList.vue')
    expect(source).not.toContain('<section v-if="kpisShown"')
    expect(source).toContain('<template v-if="kpisShown">')
    expect(source).toContain(':error="balances.error.value" @retry="balances.refetch"')
  })
})
