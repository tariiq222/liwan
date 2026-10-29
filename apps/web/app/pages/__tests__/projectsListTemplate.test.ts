import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The projects list, its forms and its settings pages stay on the shared list-card pattern of /tasks. A source guard,
// not a behaviour test: behaviour is pinned by e2e/projects.spec.ts and e2e/tasmim6-catalogs.spec.ts.
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the projects list is one list card with an embedded filter row', () => {
  const page = read('pages/projects/index.vue')

  it('puts the filter bar in the card header, with the view switch inside it', () => {
    for (const needle of ['<SharedListCard v-if="hydrated"', '<FilterBar embedded', 'views-in-filters', 'data-testid="projects-toolbar"']) expect(page, needle).toContain(needle)
  })

  it('draws no chip row, no bare toolbar div and no per-page result paragraph', () => {
    for (const gone of ['<SharedFilterChip', 'SharedFilterChoice', '<UTabs', 'projects.refresh.workspace.resultCount']) expect(page, gone).not.toContain(gone)
  })

  it('shows the count and the pager in the card footer, for both views', () => {
    expect(page.match(/<SharedListFooter/g)).toHaveLength(1)
    expect(page).toContain('#footer')
    expect(page).toContain('count-test-id="projects-result-count"')
  })

  it('renders the table bare and the cards through the shared progress bar', () => {
    expect(read('components/pmo/projects/ProjectTable.vue')).toContain('<SharedDataTable bare')
    for (const file of ['ProjectCardBody', 'ProjectProgress', 'ProjectTable']) {
      const source = read(`components/pmo/projects/${file}.vue`)
      expect(source, file).not.toContain('<UProgress')
    }
    expect(read('components/pmo/projects/ProjectCardBody.vue')).toContain('<SharedProgress')
    expect(read('components/pmo/projects/ProjectProgress.vue')).toContain('<SharedProgress')
  })
})

describe('the settings pages use the shared cards and states', () => {
  it('the catalog list is a list card with an embedded filter row and a row-actions menu', () => {
    const page = read('pages/settings/apps/projects/catalogs/[resource]/index.vue')
    for (const needle of ['<SharedListCard v-if="hydrated"', '<FilterBar embedded', '<SharedDataTable\n          bare', '<SharedRowActions']) expect(page, needle).toContain(needle)
    expect(page).not.toContain('<UTabs')
  })

  it('the settings sections are settings cards with no spacing override', () => {
    const form = read('components/settings/ProjectSettingsForm.vue')
    expect(form.match(/<SharedSettingsCard (v-if="[^"]+" )?id="project-[a-z]+"/g)).toHaveLength(4)
    expect(form).not.toMatch(/SharedSettingsCard[^>]*space-y-/)
    expect(read('pages/settings/apps/projects.vue')).not.toContain('space-y-')
  })

  it('the forms end in one footer: the secondary action, then the primary, at the end', () => {
    for (const file of ['components/pmo/projects/ProjectCopyForm.vue', 'components/pmo/projects/settings/ProjectCharterReferenceForm.vue']) {
      const source = read(file)
      expect(source, file).toMatch(/<SharedFormActions>\s*<div class="ms-auto flex items-center gap-2">/)
    }
  })
})
