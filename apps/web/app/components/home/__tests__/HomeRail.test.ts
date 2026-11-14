import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const file = resolve(import.meta.dirname, '../HomeRail.vue')

describe('HomeRail', () => {
  it('is a labelled, keyboard-focusable region around its cards', async () => {
    const html = await renderShared(file, { label: 'ابدأ بالأهم' }, { default: () => Vue.h('div', 'card') })
    expect(html).toMatch(/role="region"/)
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="ابدأ بالأهم"')
    expect(html).toContain('snap-x')
    expect(html).toContain('card')
  })
})
