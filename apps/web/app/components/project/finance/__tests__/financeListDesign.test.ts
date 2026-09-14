import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const page = readFileSync(resolve(root, '../../../pages/projects/[id]/finance.vue'), 'utf8')
const table = readFileSync(resolve(root, 'FinanceEntryTable.vue'), 'utf8')
const summary = readFileSync(resolve(root, 'FinanceSummaryCards.vue'), 'utf8')

describe('finance list design', () => {
  it('keeps search in FilterBar #search and kind in the extra-filter popover', () => {
    expect(page).toContain('<template #search>')
    expect(page).toContain('data-testid="finance-search"')
    expect(page).toContain('data-testid="finance-kind-filter"')
    expect(page).toContain('<SharedFilterChoice')
    expect(page).not.toContain('<UTabs')
    const searchSlot = page.slice(page.indexOf('<template #search>'), page.indexOf('</template>', page.indexOf('<template #search>')))
    expect(searchSlot).not.toContain('finance-kind-filter')
  })

  it('puts the primary create on EmptyState and does not render table chrome around empty', () => {
    expect(table).toContain('#action')
    expect(table).toContain("t('projects.finance.newBudget')")
    expect(table).toContain('v-else-if="items.length === 0"')
    expect(table).not.toContain('<template #empty>')
  })

  it('uses metric tiles when planned exists and does not nest a charter UCard', () => {
    expect(summary).toContain('rounded-md bg-elevated text-primary')
    expect(summary).toContain('financeSummaryMode')
    expect(summary).toContain('data-testid="project-finance-charter"')
    expect(summary).not.toMatch(/<UCard[^>]*project-finance-charter/)
  })
})
