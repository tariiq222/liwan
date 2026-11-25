import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const file = join(root, 'app/components/shared/layout/ListPage.vue')

describe('SharedListPage #kpis slot', () => {
  it('renders the #kpis slot after PageHeader and before the toolbar with automatic kpi-toggle', () => {
    const source = readFileSync(file, 'utf8')

    expect(source).toContain(':kpi-toggle="(props.kpiToggle || !!$slots.kpis) && !actionsInFrame"')
    expect(source).toContain('data-slot="list-page-kpis"')
    expect(source).toContain('<slot name="kpis" />')

    const headerEnd = source.indexOf('</PageHeader>')
    const kpisIndex = source.indexOf('data-slot="list-page-kpis"')
    const toolbarIndex = source.indexOf('data-slot="list-page-toolbar"')
    expect(headerEnd).toBeGreaterThan(-1)
    expect(kpisIndex).toBeGreaterThan(headerEnd)
    expect(toolbarIndex).toBeGreaterThan(kpisIndex)
  })
})
