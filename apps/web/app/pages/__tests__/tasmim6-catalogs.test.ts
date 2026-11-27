import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('project settings and catalogs', () => {
  it('the catalog list is a data table inside the list page template', () => {
    const page = read('pages/settings/apps/projects/catalogs/[resource]/index.vue')
    for (const needle of ['<SharedListPage', ':create-to=', '<SharedDataTable', '#mobile-row', '<SharedForbiddenState', '<SharedNotFoundState']) expect(page).toContain(needle)
    for (const gone of ['<ul>', 'border-default/80', '<SharedSettingsPage']) expect(page).not.toContain(gone)
  })
  it('the settings page frames the catalogs as a record section and loads the form through the shared page state', () => {
    const page = read('pages/settings/apps/projects.vue')
    expect(page).toContain('<SharedRecordSection v-if="shows(\'catalogs\')" id="catalogs"')
    expect(page).toContain('<SharedPageState')
    expect(read('components/settings/ProjectSettingsForm.vue')).not.toContain('<USkeleton')
  })
  it('the catalog new and edit pages use the shared states and containers', () => {
    const createPage = read('pages/settings/apps/projects/catalogs/[resource]/new.vue')
    expect(createPage).toContain('<SharedNotFoundState')
    expect(createPage).toContain('<SharedForbiddenState')
    const editPage = read('pages/settings/apps/projects/catalogs/[resource]/[referenceId]/edit.vue')
    expect(editPage).toContain('<SharedPageContainer>')
    expect(editPage).toContain('<SharedForbiddenState')
    expect(editPage).not.toContain('<SharedSettingsPage')
    expect(editPage).not.toContain('rounded-lg ring ring-default')
  })
})
