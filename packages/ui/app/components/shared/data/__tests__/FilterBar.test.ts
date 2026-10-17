import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { h } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderFilter } from '../../../../../test/helpers/filterComponents'

const field = () => h('input', { value: 'Project A' })

describe('FilterBar', () => {
  it('keeps inline project tools visible once without a collapsed card', async () => {
    const html = await renderFilter('FilterBar', { inline: true, activeCount: 1 }, {
      search: () => h('input', { 'aria-label': 'Task search' }),
      default: () => h('button', 'Task states'),
      view: () => h('button', 'Timeline'),
      actions: () => h('button', 'New task'),
      active: () => h('span', 'Selected state'),
    })
    expect(html).not.toContain('aria-expanded')
    expect(html).toContain('aria-label="Clear filters"')
    for (const text of ['Task search', 'Task states', 'Timeline', 'New task', 'Selected state']) expect(html.split(text)).toHaveLength(2)
  })
  it('embedded keeps the fields in the row from md up and collapsible on phones', async () => {
    const html = await renderFilter('FilterBar', { embedded: true, activeCount: 1 }, {
      search: () => h('input', { 'aria-label': 'Task search' }),
      default: () => h('button', 'Task states'),
      view: () => h('button', 'Done'),
      active: () => h('span', 'Selected state'),
    })
    expect(html).toContain('data-variant="embedded"')
    expect(html).toContain('md:contents!')
    expect(html).toContain('aria-expanded="false"')
    for (const text of ['Task search', 'Task states', 'Done', 'Selected state']) expect(html.split(text)).toHaveLength(2)
  })
  it('embedded draws the list page view switch at the end of the row when one is provided', async () => {
    const withSwitch = await renderFilter('FilterBar', { embedded: true }, { search: () => h('input') }, true, { view: Vue.computed(() => 'table'), options: [{ value: 'table', label: 'Table', icon: 'x' }], setView: () => {} })
    expect(withSwitch).toContain('data-slot="view-switch"')
    expect(await renderFilter('FilterBar', { embedded: true }, { search: () => h('input') })).not.toContain('view-switch')
  })
  it('disables the inline clear action until hydration', async () => {
    expect(await renderFilter('FilterBar', { inline: true, activeCount: 1 }, {}, false)).toMatch(/<button\b[^>]*disabled/)
  })
  it('renders a collapsed accessible region with localized default labels and a separate clear action', async () => {
    const html = await renderFilter('FilterBar', { activeCount: 2 }, { default: field })
    expect(html).toContain('Search and filters')
    expect(html).toContain('aria-expanded="false"')
    const id = html.match(/aria-controls="([^"]+)"/)?.[1]
    expect(id).toBeTruthy()
    expect(html).toContain(`id="${id}"`)
    expect(html).toContain('Clear filters')
    expect(html.match(/<button\b/g)).toHaveLength(2)
  })
  it('allows an explicit expanded presentation', async () => {
    expect(await renderFilter('FilterBar', { defaultOpen: true }, { default: () => h('select') })).toContain('aria-expanded="true"')
  })
  it('keeps active summary and actions visible outside the collapsed fields', async () => {
    const html = await renderFilter('FilterBar', { activeCount: 1 }, { default: field, active: () => h('span', 'Project A selected'), actions: () => h('button', 'Board view') })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Project A selected')
    expect(html).toContain('Board view')
  })
  it('does not show a clear action when there are no active filters', async () => {
    expect(await renderFilter('FilterBar', { activeCount: 0 }, { default: field })).not.toContain('Clear filters')
  })
  it('disables interaction before hydration and when explicitly disabled', async () => {
    for (const [props, hydrated] of [[{ activeCount: 1 }, false], [{ activeCount: 1, disabled: true }, true]] as const) {
      const html = await renderFilter('FilterBar', props, { default: () => h('select') }, hydrated)
      expect(html.match(/<button\b[^>]*disabled/g)).toHaveLength(2)
    }
  })
  it('keeps the search visible while extra fields stay behind the trigger', async () => {
    const html = await renderFilter('FilterBar', {}, { search: () => h('input', { 'aria-label': 'Visible search' }), default: () => h('select', [h('option', 'All states')]) })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-slot="search"')
    expect(html).toContain('All states')
  })
  it('hides the filter trigger when only search is given', async () => {
    expect(await renderFilter('FilterBar', {}, { search: () => h('input', { 'aria-label': 'Only search' }) })).not.toContain('aria-expanded')
  })
  it('renders one card with every slot in its place', async () => {
    const html = await renderFilter('FilterBar', { activeCount: 1 }, {
      search: () => h('input', { 'aria-label': 'Search' }), default: () => h('select', [h('option', 'All states')]),
      view: () => h('button', 'Board'), active: () => h('span', 'Done'),
    })
    expect(html.match(/data-slot="filter-root"/g)).toHaveLength(1)
    for (const slot of ['search', 'controls', 'view', 'active-row', 'filter-fields']) expect(html).toContain(`data-slot="${slot}"`)
  })
  it('keeps one search marker in both modes', async () => {
    for (const inline of [true, false]) {
      const html = await renderFilter('FilterBar', { inline }, { search: () => h('input'), default: () => h('select') })
      expect(html.match(/data-shortcut-search/g), `inline=${inline}`).toHaveLength(1)
    }
  })
  it('Esc in the panel closes it and returns focus to the trigger', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../FilterBar.vue'), 'utf8')
    expect(source).toMatch(/data-slot="filter-fields"[^>]*@keydown\.esc\.stop="close"/)
    expect(source).toMatch(/function close\(\) \{\s*expanded\.value = false\s*trigger\.value\?\.\$el\?\.focus\(\)/)
  })
  it('is the only filter shell: FilterCard is gone', () => {
    expect(() => readFileSync(resolve(import.meta.dirname, '../FilterCard.vue'))).toThrow()
  })
})
