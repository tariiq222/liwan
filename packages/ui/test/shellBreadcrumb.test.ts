import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from './helpers/renderShared'

const component = resolve(fileURLToPath(new URL('..', import.meta.url)), 'app/components/shell/ShellBreadcrumb.vue')

// Nuxt UI's breadcrumb marks only an item flagged `active` with aria-current.
const UBreadcrumb = Vue.defineComponent({
  inheritAttrs: false,
  props: { items: { type: Array, required: true } },
  setup(props, { attrs }) {
    return () => Vue.h('nav', attrs, (props.items as { label: string, to?: string, active?: boolean }[]).map(item => (
      Vue.h(item.to ? 'a' : 'span', { href: item.to, 'aria-current': item.active ? 'page' : undefined }, item.label)
    )))
  },
})

const render = (items: { label: string, to?: string }[]) => renderShared(component, { items }, {}, {
  messages: { 'nav.breadcrumb': 'Breadcrumb' },
  stubs: { UBreadcrumb },
})

describe('ShellBreadcrumb', () => {
  it('links every crumb but the current page and marks that one as the current page', async () => {
    const html = await render([{ label: 'Projects', to: '/projects' }, { label: 'Portal', to: '/projects/1' }, { label: 'Tasks' }])
    expect(html).toContain('data-testid="shell-breadcrumb"')
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('<a href="/projects">Projects</a>')
    expect(html).toContain('<a href="/projects/1">Portal</a>')
    expect(html).toContain('<span aria-current="page">Tasks</span>')
  })

  it('keeps a linked last crumb a link, not the current page', async () => {
    const html = await render([{ label: 'Projects', to: '/projects' }])
    expect(html).not.toContain('aria-current')
  })

  it('renders nothing for an empty trail', async () => {
    expect(await render([])).not.toContain('shell-breadcrumb')
  })
})
