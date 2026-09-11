import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { renderFilter } from './helpers/filterComponents'

describe('shared collapsible filter card', () => {
  it('keeps inline project tools visible once without a collapsed card', async () => {
    const html = await renderFilter('FilterBar', { inline: true, activeCount: 1 }, {
      search: () => h('input', { 'aria-label': 'Task search' }),
      default: () => h('button', 'Task states'),
      view: () => h('button', 'Timeline'),
      actions: () => h('button', 'New task'),
      active: () => h('span', 'Selected state'),
    })
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('<section')
    expect(html).toContain('aria-label="Clear filters"')
    for (const text of ['Task search', 'Task states', 'Timeline', 'New task', 'Selected state']) {
      expect(html.split(text)).toHaveLength(2)
    }
  })
  it('disables the inline clear action until hydration', async () => {
    const html = await renderFilter('FilterBar', { inline: true, activeCount: 1 }, {}, false)
    expect(html).toMatch(/<button\b[^>]*disabled/)
  })
  it('renders a collapsed accessible region with localized default labels and a separate clear action', async () => {
    const html = await renderFilter('FilterCard', { activeCount: 2 }, { default: () => h('input', { value: 'Project A' }) })
    expect(html).toContain('Search and filters')
    expect(html).toContain('aria-expanded="false"')
    const id = html.match(/aria-controls="([^"]+)"/)?.[1]
    expect(id).toBeTruthy()
    expect(html).toContain(`id="${id}"`)
    expect(html).toContain('Clear filters')
    expect(html.match(/<button\b/g)).toHaveLength(2)
    expect(html).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/)
  })
  it('allows an explicit expanded presentation', async () => {
    const html = await renderFilter('FilterCard', { defaultOpen: true }, { default: () => h('select') })
    expect(html).toContain('aria-expanded="true"')
  })
  it('keeps active summary/actions visible outside the filter popover', async () => {
    const html = await renderFilter('FilterCard', { activeCount: 1 }, {
      default: () => h('input', { value: 'Project A' }), active: () => h('span', 'Project A selected'), actions: () => h('button', 'Board view'),
    })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Project A selected')
    expect(html).toContain('Board view')
  })
  it('does not show a clear action when there are no active filters', async () => {
    const html = await renderFilter('FilterCard', { activeCount: 0 })
    expect(html).not.toContain('Clear filters')
  })
  it('disables interaction before hydration and when explicitly disabled', async () => {
    for (const [props, hydrated] of [[{ activeCount: 1 }, false], [{ activeCount: 1, disabled: true }, true]] as const) {
      const html = await renderFilter('FilterCard', props, { default: () => h('select') }, hydrated)
      expect(html.match(/<button\b[^>]*disabled/g)).toHaveLength(2)
    }
  })
  it('keeps FilterBar search visible while extra fields stay behind the trigger', async () => {
    const html = await renderFilter('FilterBar', { activeCount: 0 }, {
      search: () => h('input', { 'aria-label': 'Visible search' }),
      default: () => h('select', [h('option', 'All states')]),
    })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Visible search"')
    expect(html).toContain('data-slot="search"')
    expect(html).toContain('All states')
  })
  it('hides the filter trigger when FilterBar has only search', async () => {
    const html = await renderFilter('FilterBar', {}, {
      search: () => h('input', { 'aria-label': 'Only search' }),
    })
    expect(html).toContain('Only search')
    expect(html).not.toContain('aria-expanded')
  })
  it('adapts existing FilterBar slots into a single shared card', async () => {
    const html = await renderFilter('FilterBar', { activeCount: 1 }, {
      search: () => h('input', { 'aria-label': 'Search' }), default: () => h('select', [h('option', 'All states')]),
      view: () => h('button', 'Board'), active: () => h('span', 'Done'),
    })
    expect(html.match(/data-slot="filter-root"/g)).toHaveLength(1)
    for (const slot of ['search', 'controls', 'view', 'active-row']) expect(html).toContain(`data-slot="${slot}"`)
    expect(html).toContain('Board')
    expect(html).toContain('Done')
  })
})
