import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const catalogRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../pages/settings/projects/catalogs/[resource]')
const list = readFileSync(resolve(catalogRoot, 'index.vue'), 'utf8')
const create = readFileSync(resolve(catalogRoot, 'new.vue'), 'utf8')
const edit = readFileSync(resolve(catalogRoot, '[referenceId]/edit.vue'), 'utf8')
const pages = [list, create, edit]

describe('charter catalog list design', () => {
  it('uses the shared projects toolbar, search, and control layout', () => {
    expect(list).toContain(':active-count="activeFilterCount"')
    expect(list).toContain('data-testid="catalog-toolbar"')
    expect(list).toContain('FilterBar')
    expect(list).toContain('#search')
    expect(list).toContain("t('app.search')")
    expect(list).toContain('settings.projects.catalogs.showInactive')
    expect(list).toContain('@change="onSearch"')
    expect(list).toContain('toggleInactive')
  })

  it('uses SharedPageState with an actual retry for loading, error, and empty', () => {
    expect(list).toContain('SharedPageState')
    expect(list).toContain(':loading="query.isLoading.value"')
    expect(list).toContain(':error="query.error.value"')
    expect(list).toContain(':empty="!query.data.value?.items.length"')
    expect(list).toContain("empty-text=\"t('settings.projects.catalogs.empty')\"")
    expect(list).toContain('@retry="query.refetch"')
    expect(edit).toContain('SharedPageState')
    expect(edit).toContain('@retry="query.refetch"')
  })

  it('renders catalog rows with existing panel primitives', () => {
    expect(list).toContain('nasq-panel overflow-hidden')
    expect(list).toContain('v-for="item in query.data.value?.items ?? []"')
    expect(create).toContain('nasq-panel nasq-panel-body')
    expect(edit).toContain('nasq-panel nasq-panel-body')
    expect(create).not.toContain('<Card')
    expect(edit).not.toContain('<Card')
  })

  it('keeps capability, hydration, confirmations, filters, returnTo, paging, and routes', () => {
    expect(list).toContain("can('pmo.settings.manage')")
    expect(list).toContain(':disabled="!hydrated"')
    expect(list).toContain('pendingAction')
    expect(list).toContain('nasq-status-callout-danger')
    expect(list).toContain('listQuery')
    expect(list).toContain('returnToQuery(route.fullPath)')
    expect(list).toContain('CHARTER_CATALOG_PAGE_SIZE')
    expect(list).toContain('/settings/projects/catalogs/${resource.value}/new')
    expect(list).toContain('/settings/projects/catalogs/${resource.value}/${id}/edit')
    expect(create).toContain('safeReturnTo')
    expect(edit).toContain('safeReturnTo')
    for (const source of pages) {
      expect(source).not.toContain('Dialog')
      expect(source).not.toContain('Sheet')
      expect(source).not.toContain('Drawer')
    }
  })
})
