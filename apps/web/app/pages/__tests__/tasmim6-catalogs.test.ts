import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('project settings and catalogs', () => {
  it('the catalog list is a data table inside the settings template', () => {
    const page = read('pages/settings/apps/projects/catalogs/[resource]/index.vue')
    for (const needle of ['<SharedSettingsPage', '<SharedDataTable', '#mobile-row', 'data-shortcut-create']) expect(page).toContain(needle)
    for (const gone of ['<ul>', 'border-default/80']) expect(page).not.toContain(gone)
  })
  it('the settings page frames the catalogs as a record section and loads the form through the shared page state', () => {
    const page = read('pages/settings/apps/projects.vue')
    expect(page).toContain('<SharedRecordSection v-if="shows(\'catalogs\')" id="catalogs"')
    expect(page).toContain('<SharedPageState')
    expect(read('components/settings/ProjectSettingsForm.vue')).not.toContain('<USkeleton')
  })
  it('the edit page has no hand-built card', () => {
    expect(read('pages/settings/apps/projects/catalogs/[resource]/[referenceId]/edit.vue')).not.toContain('rounded-lg ring ring-default')
  })
})
