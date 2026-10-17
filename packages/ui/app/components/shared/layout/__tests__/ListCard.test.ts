import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { renderShared } from '../../../../../test/helpers/renderShared'

describe('SharedListCard', () => {
  it('is one card with the filter row above the content, and no row without filters', async () => {
    const html = await renderShared('ListCard', {}, { filters: () => h('input', { 'aria-label': 'Search' }), default: () => h('p', 'content') })
    expect(html.match(/rounded-card/g)).toHaveLength(1)
    expect(html.indexOf('Search')).toBeLessThan(html.indexOf('content'))
    expect(html).toContain('border-b border-default')
    expect(await renderShared('ListCard', {}, { default: () => h('p', 'content') })).not.toContain('list-card-filters')
  })

  it('fill makes the card screen-sized with a flexible body under the filter row', async () => {
    const html = await renderShared('ListCard', { fill: true }, { filters: () => h('input'), default: () => h('p', 'board') })
    expect(html).toContain('webvue-list-card-fill')
    expect(html).toContain('data-fill')
    expect(html).toMatch(/list-card-body[^>]*>(<!--\[-->)?<p>board/)
    expect(await renderShared('ListCard', {}, { default: () => h('p', 'board') })).not.toContain('webvue-list-card-fill')
  })
})
