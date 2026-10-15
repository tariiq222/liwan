import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('templates stay on their templates', () => {
  it('the list is a list page over a data table and the record a record page', () => {
    const list = read('pages/projects/templates/index.vue')
    for (const needle of ['<SharedListPage', '<SharedDataTable', '#mobile-row', 'liveQuery']) expect(list).toContain(needle)
    for (const gone of ['<SharedPageHeader', 'md:grid-cols-2', '<nav']) expect(list).not.toContain(gone)
    const record = read('pages/projects/templates/[id].vue')
    for (const needle of ['<SharedRecordPage', '<SharedPropertiesPanel', 'data-testid="template-delete-confirm"']) expect(record).toContain(needle)
    expect(record).not.toContain('rounded-lg ring ring-default')
  })
  it('apply wraps its form in a form section', () => {
    const apply = read('pages/projects/templates/[id]/apply.vue')
    expect(apply).toContain('<SharedFormSection panel')
    expect(apply).not.toContain('<UCard')
  })
})
