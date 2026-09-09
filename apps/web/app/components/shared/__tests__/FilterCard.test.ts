import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { renderFilter } from './helpers/filterComponents'

describe('shared collapsible filter card', () => {
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
    const html = await renderFilter('FilterCard', { defaultOpen: true })
    expect(html).toContain('aria-expanded="true"')
  })
  it('keeps selected values mounted while collapsed, and active summary/actions visible', async () => {
    const html = await renderFilter('FilterCard', { activeCount: 1 }, {
      default: () => h('input', { value: 'Project A' }), active: () => h('span', 'Project A selected'), actions: () => h('button', 'Board view'),
    })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/data-slot="filter-fields"[^>]*style="display:none;"/)
    expect(html).toContain('value="Project A"')
    expect(html).toContain('Project A selected')
    expect(html).toContain('Board view')
  })
  it('does not show a clear action when there are no active filters', async () => {
    const html = await renderFilter('FilterCard', { activeCount: 0 })
    expect(html).not.toContain('Clear filters')
  })
  it('disables interaction before hydration and when explicitly disabled', async () => {
    for (const [props, hydrated] of [[{ activeCount: 1 }, false], [{ activeCount: 1, disabled: true }, true]] as const) {
      const html = await renderFilter('FilterCard', props, {}, hydrated)
      expect(html.match(/<button\b[^>]*disabled/g)).toHaveLength(2)
    }
  })
  it('adapts existing FilterBar slots into a single shared card', async () => {
    const html = await renderFilter('FilterBar', { activeCount: 1 }, {
      search: () => h('input', { 'aria-label': 'Search' }), default: () => h('select', [h('option', 'All states')]),
      view: () => h('button', 'Board'), active: () => h('span', 'Done'),
    })
    expect(html.match(/<section\b/g)).toHaveLength(1)
    for (const slot of ['search', 'controls', 'view', 'active-row']) expect(html).toContain(`data-slot="${slot}"`)
    expect(html.indexOf('Board')).toBeLessThan(html.indexOf('aria-label="Search"'))
    expect(html).toContain('Done')
  })
})
