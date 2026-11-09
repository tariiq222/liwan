import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

describe('SharedSubCard', () => {
  it('is a 12px-radius box with a 1.5px hairline border and the sub-card padding token', async () => {
    const html = await renderShared('SubCard', {}, { default: () => h('p', 'BODY') })
    expect(html).toMatch(/^<div[^>]*data-slot="sub-card"/)
    expect(html).toContain('rounded-control')
    expect(html).toContain('p-(--liwan-subcard-pad)')
    expect(html).toContain('border-[1.5px] border-default')
    expect(html).toContain('BODY')
  })

  it('tinted drops the border for a soft fill, and `as` picks the element', async () => {
    const html = await renderShared('SubCard', { tone: 'tinted', as: 'li' }, { default: () => h('span', 'x') })
    expect(html).toMatch(/^<li/)
    expect(html).toContain('bg-elevated/50')
    expect(html).not.toContain('border-default')
  })
})
