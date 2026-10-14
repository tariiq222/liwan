import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the personal task record is a record page', () => {
  it('the page is a record page with a properties aside and no ring cards', () => {
    const page = read('pages/my-tasks/[id].vue')
    for (const needle of ['<SharedRecordPage', '<SharedPropertiesPanel', 'data-testid="my-task-detail"', '<SharedRecordSection']) expect(page).toContain(needle)
    for (const gone of ['<SharedPageHeader', 'const panel =', ':class="panel"']) expect(page).not.toContain(gone)
  })
  it.each(['MyTaskSubtasks', 'MyTaskComments', 'MyTaskAttachments', 'ConvertToProject'])('%s is a record section', (name) => {
    const source = read(`components/my-tasks/${name}.vue`)
    expect(source).toContain('<SharedRecordSection')
    expect(source).not.toMatch(/<h2 class="text-lg font-semibold/)
  })
})
