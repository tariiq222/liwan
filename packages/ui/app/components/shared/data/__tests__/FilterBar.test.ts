import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { h } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadFilterComponent, renderFilter } from '../../../../../test/helpers/filterComponents'

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
  it('sets each field label beside its control from md up in every variant', async () => {
    const field = () => h(loadFilterComponent('FilterField'), { label: 'State', for: 'state' }, () => h('select', { id: 'state' }))
    for (const props of [{ inline: true }, { embedded: true }, {}]) expect(await renderFilter('FilterBar', props, { default: field }), JSON.stringify(props)).toContain('md:flex')
  })
  it('lays the search, the chips and the view in one row: the search grows from 220px, the view sits at the end', async () => {
    const html = await renderFilter('FilterBar', {}, { search: () => h('input'), default: () => h('select'), view: () => h('button', 'Board') })
    expect(html).toContain('data-slot="filter-row"')
    expect(html).toContain('md:basis-55')
    expect(html).toContain('md:min-w-55')
    expect(html).toMatch(/data-slot="view" class="[^"]*md:ms-auto/)
    expect(html).toContain('md:contents!')
  })
  it('gives the search the whole first row in a narrow workspace only when there are fields under it', async () => {
    const withFields = await renderFilter('FilterBar', {}, { search: () => h('input'), default: () => h('select') })
    expect(withFields).toContain('@container/filters')
    expect(withFields).toContain('md:basis-full @4xl/filters:basis-55')
    expect(await renderFilter('FilterBar', {}, { search: () => h('input') })).not.toContain('md:basis-full')
  })
  it('fills the phone row with the view switch', async () => {
    const html = await renderFilter('FilterBar', {}, { search: () => h('input'), view: () => h('button', 'Board') })
    expect(html).toMatch(/data-slot="view" class="[^"]*\bw-full\b[^"]*md:w-auto/)
  })
  it('styles every select, picker and date trigger in the row as a soft 40px chip with a 44px touch target', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../../../assets/css/components.css'), 'utf8')
    const trigger = String.raw`button\[data-slot="base"\]:is\(\[role="combobox"\], \[aria-haspopup="listbox"\], \[aria-haspopup="dialog"\]\)`
    expect(css).toMatch(new RegExp(String.raw`\[data-slot="filter-root"\] ${trigger} \{[^}]*background-color: var\(--ui-bg-elevated\)`))
    expect(css).toMatch(/min-height: var\(--liwan-filter-h, 40px\)/)
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\[data-slot="filter-root"\][^}]*min-height: 44px/)
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

describe('FilterPopover', () => {
  it('is one labelled button with the active count and the fields inside the popover', async () => {
    const html = await renderFilter('FilterPopover', { count: 2 }, { default: () => h('select', [h('option', 'Any type')]) })
    expect(html).toContain('Filters')
    expect(html).toContain('data-slot="filter-popover-count"')
    expect(html).toContain('>2<')
    expect(html).toContain('Any type')
  })
  it('draws no count badge without active filters and disables the button before hydration', async () => {
    expect(await renderFilter('FilterPopover', { count: 0 })).not.toContain('filter-popover-count')
    expect(await renderFilter('FilterPopover', {}, {}, false)).toMatch(/<button\b[^>]*disabled/)
  })
})
