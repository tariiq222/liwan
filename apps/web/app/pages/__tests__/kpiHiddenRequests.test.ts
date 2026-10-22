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
    ['pages/projects/[id]/tasks.vue', '<TaskKpiStrip v-if="kpisShown"'],
    ['pages/operations/index.vue', '<RequestKpiStrip v-if="kpisShown" scope="mine"'],
    ['pages/operations/pending.vue', '<RequestKpiStrip v-if="kpisShown" scope="pending"'],
    ['pages/operations/monitoring.vue', '<RequestKpiStrip v-if="kpisShown" scope="monitoring"'],
    ['components/finance/invoices/InvoiceList.vue', '<InvoiceKpiStrip v-if="kpisShown"'],
  ])('%s mounts its strip only while shown', (file, mount) => {
    expect(read(file)).toContain(mount)
  })

  it.each([
    ['pages/documents.vue', ['const kpiEnabled = computed(() => isListRoute.value && kpisShown.value)', 'useDocuments({ limit: 1 }, kpiEnabled)']],
    ['pages/hr/index.vue', ['useHrEmployees({ limit: 1 }, kpisShown)', 'kpisShown.value && canManage.value']],
    ['pages/finance/index.vue', ["useFinanceAging('receivable', computed(() => kpisShown.value && canStatements.value))", 'useFinancePartners({ limit: 1 }, computed(() => kpisShown.value && canPartners.value))']],
    ['pages/my-tasks/index.vue', ['}, kpisShown)']],
    ['pages/meetings/index.vue', ['}), kpisShown)']],
    ['pages/meetings/series.vue', ['useMeetingSeriesKpis(kpisShown)']],
    ['pages/meetings/follow-up.vue', ['}), kpisShown)']],
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
