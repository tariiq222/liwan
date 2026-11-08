import { resolve } from 'node:path'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadShared, renderShared } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, findNode, hostRenderer, type HostNode } from '@liwan/ui/test/helpers/hostRenderer'

const file = resolve(import.meta.dirname, '../HomeRail.vue')

afterEach(() => vi.unstubAllGlobals())

function scrollOnce(direction: 'rtl' | 'ltr', step: 1 | -1, reduced = false) {
  vi.stubGlobal('getComputedStyle', () => ({ direction }))
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) })
  const Rail = loadShared(file, { globals: { ref: Vue.ref } })
  const rail = Vue.ref<{ scrollCards: (direction: 1 | -1) => void } | null>(null)
  const app = hostRenderer.createApp({ render: () => Vue.h(Rail, { ref: rail, label: 'ابدأ بالأهم' }) })
  const host = createHostNode()
  app.mount(host)
  const region = findNode(host, node => node.props.role === 'region') as HostNode & { scrollBy?: ReturnType<typeof vi.fn> }
  region.scrollBy = vi.fn()
  rail.value!.scrollCards(step)
  app.unmount()
  return { region, scrollBy: region.scrollBy }
}

describe('HomeRail', () => {
  it('is a labelled, keyboard-focusable region around its cards', async () => {
    const html = await renderShared(file, { label: 'ابدأ بالأهم' }, { default: () => Vue.h('div', 'card') })
    expect(html).toMatch(/role="region"/)
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="ابدأ بالأهم"')
    expect(html).toContain('snap-x')
    expect(html).toContain('card')
  })

  it('scrolls toward the end of the reading direction: left in Arabic, right in English', () => {
    expect(scrollOnce('rtl', 1).scrollBy).toHaveBeenCalledWith({ left: -320, behavior: 'smooth' })
    expect(scrollOnce('rtl', -1).scrollBy).toHaveBeenCalledWith({ left: 320, behavior: 'smooth' })
    expect(scrollOnce('ltr', 1).scrollBy).toHaveBeenCalledWith({ left: 320, behavior: 'smooth' })
  })

  it('jumps instead of gliding for someone who prefers reduced motion', () => {
    expect(scrollOnce('ltr', 1, true).scrollBy).toHaveBeenCalledWith({ left: 320, behavior: 'auto' })
  })
})
