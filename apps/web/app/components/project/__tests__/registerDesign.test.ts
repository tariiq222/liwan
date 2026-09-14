import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const listSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../pages/projects/[id]/register/index.vue'),
  'utf8',
)

describe('register list design alignment', () => {
  it('uses the /projects toolbar, FilterBar, SharedFilterChoice, and UTable primitives', () => {
    expect(listSource).toContain(':active-count="activeFilterCount"')
    expect(listSource).toContain("import FilterBar from '@/components/shared/FilterBar.vue'")
    expect(listSource.match(/<SharedFilterChoice\b/g)?.length).toBe(3)
    expect(listSource).not.toContain('<USelect')
    expect(listSource).not.toContain("value: ''")
    expect(listSource).toContain('<SharedFilterChip')
    expect(listSource).not.toContain('<UBadge v-if="parsed.')
    expect(listSource).toContain('<UTable :data="list.data.value.items" :columns="columns">')
    expect(listSource).toContain('#id-cell="{ row }"')
    expect(listSource).toContain('@click="deleteItem(row.original)"')
    expect(listSource).not.toContain('nasq-input')
    const formSource = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../governance/RegisterForm.vue'),
      'utf8',
    )
    const stakeholderForm = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../governance/StakeholderForm.vue'),
      'utf8',
    )
    expect(formSource).not.toContain('nasq-input')
    expect(stakeholderForm).not.toContain('nasq-input')
    expect(listSource).not.toMatch(/class="flex flex-wrap items-center gap-3"/)
    expect(listSource).not.toMatch(/<(Dialog|Sheet|Drawer)\b/)
  })

  it('keeps query filters, pagination, gates, inline delete, and returnTo links', () => {
    expect(listSource).toContain("setFilter('q'")
    expect(listSource).toContain("setFilter('kind'")
    expect(listSource).toContain("setFilter('status'")
    expect(listSource).toContain("setFilter('priority'")
    expect(listSource).toContain('offset: undefined')
    expect(listSource).toContain('function page(delta: number)')
    expect(listSource).toContain('list.data.value?.can_manage && hydrated')
    expect(listSource).toContain(':disabled="!hydrated"')
    expect(listSource).toContain('confirmDeleteId')
    expect(listSource).toContain('projects.governance.confirmDeleteAction')
    // A register row no longer hands its own URL to the record as a referrer:
    // the record's back target is fixed by its route, so the param would be
    // dead weight that rides back onto this list's URL.
    expect(listSource).not.toContain('returnTo')
    expect(listSource).toContain('`/projects/${id}/register/${row.original.id}`')
    expect(listSource).toContain('/governance`')
    // Nested project pages own their section heading; the parent page is now
    // only the workspace frame, and the base route's own content (including the
    // not-found escape back to /projects) lives in its summary child page.
    const here = dirname(fileURLToPath(import.meta.url))
    const projectSource = readFileSync(resolve(here, '../../../pages/projects/[id].vue'), 'utf8')
    const summarySource = readFileSync(resolve(here, '../../../pages/projects/[id]/index.vue'), 'utf8')
    expect(projectSource).not.toContain('ProjectWorkspaceNav')
    expect(projectSource).toContain('<NuxtPage')
    expect(projectSource).not.toContain('isBaseRoute')
    expect(projectSource).not.toContain('projectReturnTo')
    expect(summarySource).toContain('<SharedPageContainer width="list">')
    expect(summarySource).toContain('projectReturnTo')
    expect(summarySource).not.toContain(':back-to="projectReturnTo"')
  })
})
