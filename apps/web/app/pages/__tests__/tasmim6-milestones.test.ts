import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')

describe('milestones stay on their templates', () => {
  it('the list page is a hide-header list page with the existing create test id', () => {
    const page = read('pages/projects/[id]/milestones.vue')
    for (const needle of ['<SharedListPage', 'hide-header', 'create-test-id="project-header-create"']) expect(page).toContain(needle)
    expect(page).not.toContain('<SharedPageHeader')
    expect(page).not.toContain('<USkeleton')
  })
  it('the table renders through SharedDataTable with a phone row and no card of its own', () => {
    const table = read('components/pmo/projects/MilestoneTable.vue')
    expect(table).toContain('<SharedDataTable')
    expect(table).toContain('#mobile-row')
    for (const gone of ['<UCard', '<USkeleton', '<UBadge', 'divide-y']) expect(table).not.toContain(gone)
  })
  it('the delete confirmation follows the live list', () => {
    expect(read('components/pmo/projects/MilestoneTable.vue')).toContain('items.value.find(m => m.id === deleteId.value)')
  })
  it('the KPI strip counts the rows the table loads, without a request of its own, and its tiles are not links', () => {
    const page = read('pages/projects/[id]/milestones.vue')
    for (const needle of ['<template #kpis>', 'useKpiVisibility', 'useMilestones', 'isMilestoneOverdue', 'data-testid="milestone-kpi-strip"']) expect(page).toContain(needle)
    const start = page.indexOf('<template #kpis>')
    const strip = page.slice(start, page.indexOf('</template>', start))
    // No status filter exists on this list, so a tile must not claim one.
    expect(strip).not.toContain(':to=')
  })
  it('the edit page has no hand-built card', () => {
    const edit = read('pages/projects/[id]/milestones/[milestoneId]/edit.vue')
    expect(edit).toMatch(/<SharedFormSection[^>]* panel/)
    expect(edit).not.toContain('rounded-lg ring ring-default')
  })
})
