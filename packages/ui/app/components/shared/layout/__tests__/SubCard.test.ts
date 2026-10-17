import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

describe('SharedSubCard', () => {
  it('is a 12px-radius box with a hairline ring and the sub-card padding token', async () => {
    const html = await renderShared('SubCard', {}, { default: () => h('p', 'BODY') })
    expect(html).toMatch(/^<div[^>]*data-slot="sub-card"/)
    expect(html).toContain('rounded-control')
    expect(html).toContain('p-(--webvue-subcard-pad)')
    expect(html).toContain('ring ring-default')
    expect(html).toContain('BODY')
  })

  it('tinted drops the ring for a soft fill, and `as` picks the element', async () => {
    const html = await renderShared('SubCard', { tone: 'tinted', as: 'li' }, { default: () => h('span', 'x') })
    expect(html).toMatch(/^<li/)
    expect(html).toContain('bg-elevated/50')
    expect(html).not.toContain('ring-default')
  })
})
