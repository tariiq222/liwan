import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The finance pages stay on their templates. This is a source guard, not a behaviour test.
const app = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the finance pages stay on their templates', () => {
  it.each([
    ['pages/finance/index.vue', ['<SharedListPage', 'kpi-toggle', '<SharedKpiStrip', '<SharedRecordSection', '<SharedPageState']],
    ['pages/finance/partners/index.vue', ['<SharedListPage', 'create-test-id="finance-partner-new"', ':tags="headerTags"', "kind: 'count'", '<SharedListCard', '<SharedListFooter', 'embedded', '<SharedFilterChoice', '<SharedSegmentedControl', '<SharedInlineConfirm', '<SharedEmptyState']],
    ['pages/finance/partners/[partnerId].vue', ['<SharedRecordPage', '<SharedIdentityCard', '<SharedInlineConfirm', '<SharedRowActions', ':tags="headerTags"', "kind: 'category'", '#aside']],
    ['pages/finance/partners/[partnerId]/edit.vue', ['<PartnerForm', ':back-to="backTo"', '<SharedPageContainer width="form"']],
    ['components/finance/PartnerTable.vue', ['<SharedDataTable', ' bare', '#mobile-row', '<SharedRowActions', '<SharedStatusBadge']],
    ['components/finance/PartnerProperties.vue', ['<SharedPropertiesPanel', '<SharedPropertyRow']],
    ['components/finance/PartnerForm.vue', ['<SharedFormSection panel', '<SharedFormActions', '<SharedUnsavedChanges']],
    ['components/finance/SetupChecklist.vue', ['<SharedChecklist']],
    ['pages/settings/apps/finance/index.vue', ['<SharedSettingsPage', '<SharedPageHeader', '<SharedRecordSection', '<SharedPropertiesPanel', '<SetupChecklist']],
  ])('%s uses its template', (file, needles) => {
    const source = read(file)
    for (const needle of needles) expect(source, needle).toContain(needle)
  })

  it('draws no hand-made table or skeleton and no physical-direction class in the finance files', () => {
    for (const file of ['pages/finance/index.vue', 'pages/finance/partners/index.vue', 'components/finance/PartnerTable.vue', 'components/finance/PartnerForm.vue', 'components/finance/DraftDocumentList.vue', 'pages/settings/apps/finance/index.vue']) {
      const source = read(file)
      expect(source, file).not.toMatch(/<UTable\b/)
      expect(source, file).not.toMatch(/<USkeleton\b/)
      expect(source, file).not.toMatch(/md:hidden/)
      expect(source, file).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/)
      expect(source, file).not.toMatch(/rounded-(md|lg|xl|\[)/)
    }
  })

  it('keeps the create panel route-backed over the partner list', () => {
    expect(read('pages/finance/partners/new.vue')).toContain('<SharedCreatePanel')
    const parent = read('pages/finance/partners.vue')
    expect(parent).toContain("'/finance/partners/new'")
    expect(parent).toContain('<PartnerList v-if="isCreateRoute" />')
  })

  it('gates every write control behind its manage capability', () => {
    expect(read('pages/finance/partners/index.vue')).toContain("can('finance.partners.manage')")
    expect(read('pages/finance/partners/[partnerId].vue')).toContain("can('finance.partners.manage')")
    expect(read('pages/finance/partners/new.vue')).toContain("can('finance.partners.manage')")
    expect(read('pages/settings/apps/finance/index.vue')).toContain("can('finance.setup.manage')")
  })
})
