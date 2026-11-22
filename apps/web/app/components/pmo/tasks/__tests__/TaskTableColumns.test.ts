import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// SharedDataTable gives the title column the width the others leave, and it finds that column as the first data column
// unless one flags `meta.title`. The task table's record number is an optional 48px `#` column, so without the flag the
// name column lost its 11rem floor to the number whenever the user turned `#` on.
const source = readFileSync(resolve(import.meta.dirname, '../TaskTable.vue'), 'utf8')

describe('TaskTable title column', () => {
  it('marks the task name as the title rather than letting the first column win', () => {
    expect(source).toMatch(/column\('title'/)
    expect(source).toMatch(/title: true/)
  })

  it('keeps the record number a plain short column', () => {
    expect(source).toContain("record_number: () => column('record_number'")
    expect(source).not.toMatch(/record_number: [^\n]*title: true/)
  })
})
