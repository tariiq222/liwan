import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(import.meta.dirname, '../../..')
const listSource = readFileSync(resolve(appRoot, 'pages/hr/documents/index.vue'), 'utf8')
const newSource = readFileSync(resolve(appRoot, 'pages/hr/documents/new.vue'), 'utf8')

describe('HR documents list design', () => {
  it('uses the shared toolbar and FilterBar instead of a native h-9 filter select', () => {
    expect(listSource).toContain('FilterBar')
    expect(listSource).toContain('class="nasq-toolbar"')
    expect(listSource).toContain('SelectTrigger')
    expect(listSource).not.toMatch(/<select[\s\S]*h-9/)
    expect(listSource).not.toMatch(/nasq-toolbar[^\n"']*nasq-panel|nasq-panel[^\n"']*nasq-toolbar/)
  })

  it('keeps create in the toolbar and the document list with shared page state', () => {
    expect(listSource).toContain("can('hr.documents.manage')")
    expect(listSource).toContain("can('hr.departments.read')")
    expect(listSource).toContain('/hr/documents/new')
    expect(listSource).toContain('returnToQuery')
    expect(listSource).toContain('SharedPageState')
    expect(listSource).toContain('useHydrated')
    expect(listSource).toContain('setPage')
    expect(listSource).toMatch(/\/hr\/departments\/\$\{document\.department\.id\}\/documents\/\$\{document\.id\}/)
    expect(listSource).not.toMatch(/<Table[\s>]/)
    const toolbar = listSource.indexOf('nasq-toolbar')
    const create = listSource.indexOf("t('hr.docs.new')")
    const list = listSource.indexOf('query.data.value?.items')
    expect(toolbar).toBeGreaterThanOrEqual(0)
    expect(create).toBeGreaterThan(toolbar)
    expect(list).toBeGreaterThan(create)
  })
})

describe('HR documents create design', () => {
  it('uses the shared Select control and keeps create data flow', () => {
    expect(newSource).toContain('SelectTrigger')
    expect(newSource).toContain('DocumentCreateForm')
    expect(newSource).toContain('SharedPageState')
    expect(newSource).toContain('useHydrated')
    expect(newSource).toContain('safeReturnTo')
    expect(newSource).toContain('returnToQuery')
    expect(newSource).toContain('department_id')
    expect(newSource).not.toMatch(/<select[\s\S]*h-9/)
    expect(newSource).not.toMatch(/nasq-toolbar[^\n"']*nasq-panel|nasq-panel[^\n"']*nasq-toolbar/)
  })
})
