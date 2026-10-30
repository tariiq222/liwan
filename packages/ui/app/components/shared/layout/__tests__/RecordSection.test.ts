import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

const render = (props: Record<string, unknown>, actions = false) => renderShared('RecordSection', { title: 'Milestones', ...props }, {
  default: () => h('p', 'BODY'),
  ...(actions ? { actions: () => h('button', 'Add') } : {}),
})

describe('SharedRecordSection variants', () => {
  it('is flat by default: a page-section title (text-base) and no card', async () => {
    const html = await render({})
    expect(html).toContain('data-variant="flat"')
    expect(html).toContain('text-base font-semibold')
    expect(html).not.toContain('rounded-card')
    expect(html).not.toContain('liwan-record-panel')
  })

  it('panel is the card: ring, hairline under a text-sm title, card padding body', async () => {
    const html = await render({ variant: 'panel' })
    expect(html).toContain('liwan-record-panel')
    expect(html).toContain('rounded-card')
    expect(html).toContain('ring ring-default')
    expect(html).toContain('border-b border-default')
    expect(html).toContain('px-(--liwan-card-pad) py-3')
    expect(html).toContain('p-(--liwan-card-pad)')
    expect(html).toContain('text-sm font-semibold')
    expect(html).not.toContain('text-lg')
  })

  it('list is a card whose body has no padding and divides its rows', async () => {
    const html = await render({ variant: 'list' })
    expect(html).toContain('overflow-hidden')
    expect(html).toContain('<div class="divide-y divide-default">')
    expect(html).not.toContain('<div class="p-(--liwan-card-pad)')
    expect(html).toContain('border-b border-default')
  })

  it('tinted has a soft fill and no ring or header hairline', async () => {
    const html = await render({ variant: 'tinted' })
    expect(html).toContain('bg-elevated/40')
    expect(html).not.toContain('ring-default')
    expect(html).not.toContain('border-b')
  })

  it('action has the primary tint, the primary hairline and the inline-start accent', async () => {
    const html = await render({ variant: 'action' }, true)
    expect(html).toContain('bg-primary/5')
    expect(html).toContain('ring-primary/30')
    expect(html).toContain('border-s-4 border-s-primary')
    expect(html.indexOf('Add')).toBeLessThan(html.indexOf('BODY'))
  })

  it('a card with no title, description or actions draws no header row and no label', async () => {
    const html = await renderShared('RecordSection', { variant: 'panel' }, { default: () => h('p', 'BODY') })
    expect(html).not.toContain('<header')
    expect(html).not.toContain('aria-labelledby')
  })
})

describe('SharedPropertiesPanel and SharedFormSection delegate to the panel recipe', () => {
  it('PropertiesPanel is a panel card around the description list', async () => {
    const html = await renderShared('PropertiesPanel', { title: 'Properties' }, { default: () => h('div', 'ROW') })
    expect(html).toContain('data-slot="properties-panel"')
    expect(html).toContain('data-variant="panel"')
    expect(html).toContain('<dl class="divide-y divide-default">')
  })

  it('FormSection panel is the same card; its heading stays text-sm', async () => {
    const html = await renderShared('FormSection', { title: 'General', panel: true }, { default: () => h('input') })
    expect(html).toContain('data-variant="panel"')
    expect(html).toContain('text-sm font-semibold')
    expect(html).not.toContain('text-lg')
  })
})
