import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('the RACI page stays on the list template with a purpose-built matrix', () => {
  it('the page is a hide-header list page and the matrix is its own component', () => {
    const page = read('pages/projects/[id]/raci.vue')
    for (const needle of ['<SharedListPage', 'hide-header', '<RaciMatrix', '<SharedRecordSection', '<SharedPagination']) expect(page).toContain(needle)
    for (const gone of ['<table', '<SharedPageHeader', '<section class="rounded-lg']) expect(page).not.toContain(gone)
    const matrix = read('components/project/governance/RaciMatrix.vue')
    expect(matrix).toContain('<table')
    expect(matrix).not.toContain('<style')
  })
})
