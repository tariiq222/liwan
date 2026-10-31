import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

const body = { default: () => h('form', { 'data-body': '' }), footer: () => h('button', 'Print') }

describe('SharedStandalonePage', () => {
  it('card is the page main with a centred card, its title as h1 and the footer in the card', async () => {
    const html = await renderShared('StandalonePage', { title: 'Sign in' }, body)
    expect(html.startsWith('<main')).toBe(true)
    expect(html).toContain('data-variant="card"')
    expect(html).toContain('min-h-svh')
    expect(html).toMatch(/<h1[^>]*>Sign in<\/h1>/)
    expect(html.indexOf('data-body')).toBeLessThan(html.indexOf('>Print<'))
    expect(html).not.toContain('liwan-print')
  })

  it('brand surface fills the page with the lavender token and draws the brand slot above the card', async () => {
    const html = await renderShared('StandalonePage', { surface: 'brand' }, { ...body, brand: () => h('span', { 'data-logo': '' }) })
    expect(html).toContain('data-surface="brand"')
    expect(html).toContain('bg-(--primary-solid)')
    expect(html).not.toContain('bg-default')
    expect(html.indexOf('data-logo')).toBeLessThan(html.indexOf('data-body'))
  })

  it('default surface keeps the default background and ignores the brand slot', async () => {
    const html = await renderShared('StandalonePage', {}, { ...body, brand: () => h('span', { 'data-logo': '' }) })
    expect(html).toContain('data-surface="default"')
    expect(html).toContain('bg-default')
    expect(html).not.toContain('data-logo')
  })

  it('print is an article inside the shell main, black-on-white class, footer not printed', async () => {
    const html = await renderShared('StandalonePage', { variant: 'print', title: 'Minutes' }, body)
    expect(html.startsWith('<article')).toBe(true)
    expect(html).not.toContain('<main')
    expect(html).toMatch(/class="liwan-print[ "]/)
    expect(html).toContain('data-variant="print"')
    expect(html).toMatch(/<h1[^>]*>Minutes<\/h1>/)
    expect(html).toMatch(/<footer class="liwan-print-hide[^"]*">(?:<!--\[-->)?<button>Print<\/button>/)
  })

  it('renders no heading and no footer when they are not given', async () => {
    for (const variant of ['card', 'print']) {
      const html = await renderShared('StandalonePage', { variant }, { default: () => h('p', 'x') })
      expect(html, variant).not.toContain('<h1')
      expect(html, variant).not.toContain('<footer')
    }
  })

  it('card draws the header slot in place of the title heading', async () => {
    const header = () => h('div', { 'data-brand': '' }, [h('h1', 'LiwanOS'), h('p', 'Sign in to continue')])
    const html = await renderShared('StandalonePage', { title: 'Ignored' }, { ...body, header })
    expect(html).toContain('data-brand')
    expect(html).not.toContain('Ignored')
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html.indexOf('data-brand')).toBeLessThan(html.indexOf('data-body'))
  })

  it('card draws the header slot even without a title', async () => {
    const html = await renderShared('StandalonePage', {}, { ...body, header: () => h('h1', 'Brand') })
    expect(html).toMatch(/<h1[^>]*>Brand<\/h1>/)
  })

  it('print ignores the header slot', async () => {
    const html = await renderShared('StandalonePage', { variant: 'print', title: 'Minutes' }, { ...body, header: () => h('div', { 'data-brand': '' }) })
    expect(html).not.toContain('data-brand')
    expect(html).toMatch(/<h1[^>]*>Minutes<\/h1>/)
  })
})
