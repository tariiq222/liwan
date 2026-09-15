import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(import.meta.dirname, '../../..')
const listSource = readFileSync(resolve(appRoot, 'pages/hr/documents.vue'), 'utf8')
const newSource = readFileSync(resolve(appRoot, 'pages/hr/documents/new.vue'), 'utf8')

describe('HR documents list design', () => {
  it('uses the shared toolbar and FilterBar instead of a native h-9 filter select', () => {
    expect(listSource).toContain('FilterBar')
    expect(listSource).toContain(':active-count="activeFilterCount"')
    expect(listSource).toContain('<USelect')
    expect(listSource).not.toMatch(/<select[\s\S]*h-9/)
    expect(listSource).not.toMatch(/nasq-toolbar[^\n"']*nasq-panel|nasq-panel[^\n"']*nasq-toolbar/)
  })

  it('keeps the document list with shared page state and leaves create to the pinned sidebar action', () => {
    expect(listSource).toContain("can('hr.departments.read')")
    expect(listSource).toContain('returnToQuery')
    expect(listSource).toContain('SharedPageState')
    expect(listSource).toContain('useHydrated')
    expect(listSource).toContain('setPage')
    expect(listSource).toMatch(/\/hr\/departments\/\$\{document\.department\.id\}\/documents\/\$\{document\.id\}/)
    expect(listSource).toContain('<UTable')
    expect(listSource).toContain("t('app.recordNumber')")
    expect(listSource).toContain('<RecordNumber :value="row.original.id" />')
    expect(listSource).not.toContain("t('hr.docs.new')")
    const toolbar = listSource.indexOf('<FilterBar')
    const list = listSource.indexOf('query.data.value?.items')
    expect(toolbar).toBeGreaterThan(0)
    expect(list).toBeGreaterThan(toolbar)
  })
})

describe('HR documents create design', () => {
  it('uses the shared Select control and keeps create data flow', () => {
    expect(newSource).toContain('<USelect')
    expect(newSource).toContain('DocumentCreateForm')
    expect(newSource).toContain('SharedPageState')
    expect(newSource).toContain('useHydrated')
    // The owning list is the route's own, not a referrer's: /hr/documents/new
    // belongs to /hr/documents whatever link opened it.
    expect(newSource).not.toContain('safeReturnTo')
    expect(newSource).toContain("path: '/hr/documents'")
    expect(newSource).toContain('returnTo: _referrer')
    expect(newSource).toContain('department_id')
    expect(newSource).not.toMatch(/<select[\s\S]*h-9/)
    expect(newSource).not.toMatch(/nasq-toolbar[^\n"']*nasq-panel|nasq-panel[^\n"']*nasq-toolbar/)
  })
})
