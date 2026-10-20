import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The bank pages stay on their templates. This is a source guard, not a behaviour test.
const app = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

const BANK_FILES = [
  'pages/finance/bank/statements/index.vue',
  'pages/finance/bank/statements/new.vue',
  'pages/finance/bank/statements/[id]/index.vue',
  'pages/finance/bank/statements/[id]/lines/[lineId].vue',
  'components/finance/bank/BankStatementList.vue',
  'components/finance/bank/BankKpiStrip.vue',
  'components/finance/bank/BankStatementForm.vue',
  'components/finance/bank/BankStatementBody.vue',
  'components/finance/bank/BankStatementAside.vue',
  'components/finance/bank/ReconcileBody.vue',
]

describe('the bank pages stay on their templates', () => {
  it.each([
    ['pages/finance/bank/statements/index.vue', ['<SharedListPage', '<BankStatementList']],
    ['pages/finance/bank/statements/new.vue', ['<SharedListPage', '<SharedCreatePanel', 'background', '<SharedForbiddenState']],
    ['pages/finance/bank/statements/[id]/index.vue', ['<SharedRecordPage', '#aside']],
    ['pages/finance/bank/statements/[id]/lines/[lineId].vue', ['<SharedRecordPage', '<SharedForbiddenState']],
    ['components/finance/bank/useBankListPage.ts', ['kpiToggle: true', "kind: 'count'", "can('finance.bank.manage')", 'returnTo']],
    ['components/finance/bank/BankStatementList.vue', ['<SharedListCard', 'embedded', '<SharedDateField', '<SharedDataTable', ' bare', '#mobile-row', '<SharedListFooter', '<SharedRecordNumber', '<SharedStatusBadge', '<SharedPageState', '<SharedEmptyState', 'useKpiVisibility']],
    ['components/finance/bank/BankKpiStrip.vue', ['<SharedKpiStrip']],
    ['components/finance/bank/BankStatementForm.vue', ['<SharedUnsavedChanges', '<SharedFormSection panel', '<SharedFormActions', 'color="error" variant="subtle"', '<PartnerPicker', '<UFormField']],
    ['components/finance/bank/useBankStatementRecord.ts', ["kind: 'category'", "kind: 'count'", 'statusTag(']],
    ['components/finance/bank/BankStatementBody.vue', ['<SharedKpiStrip', '<SharedDataTable', "can('finance.bank.manage')", '#mobile-row']],
    ['components/finance/bank/BankStatementAside.vue', ['<SharedPropertiesPanel', '<SharedPropertyRow']],
    ['components/finance/bank/ReconcileBody.vue', ['<SharedRecordSection variant="action"', '<SharedRecordSection v-if="!page.open" variant="tinted"', '<SharedDataTable', 'selectable', '<SharedInlineConfirm', '<SharedStatusBadge', '<AccountPicker']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
  })

  it('draws no hand-made table or skeleton, no physical-direction class and no square corners in the bank files', () => {
    for (const file of BANK_FILES) {
      const source = read(file)
      expect(source, file).not.toMatch(/<UTable\b/)
      expect(source, file).not.toMatch(/<USkeleton\b/)
      expect(source, file).not.toMatch(/v-html/)
      expect(source, file).not.toMatch(/<style\b/)
      expect(source, file).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/)
      expect(source, file).not.toMatch(/rounded-(md|lg|xl|\[)/)
    }
  })

  it('keeps the create panel route-backed over the statements list', () => {
    expect(read('pages/finance/bank/statements/new.vue')).toContain('<SharedCreatePanel')
    expect(read('components/finance/bank/useBankCreatePage.ts')).toContain('useBankListPage(true)')
  })

  it('gates every write control behind its manage capability', () => {
    expect(read('components/finance/bank/useBankListPage.ts')).toContain("can('finance.bank.manage')")
    expect(read('components/finance/bank/useBankCreatePage.ts')).toContain("can('finance.bank.manage')")
    expect(read('components/finance/bank/useBankReconcilePage.ts')).toContain("can('finance.bank.manage')")
    expect(read('components/finance/bank/BankStatementBody.vue')).toContain("can('finance.bank.manage')")
  })
})
