import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { createReusableTemplate } from '@vueuse/core'
import { renderShared, loadShared } from '@liwan/ui/test/helpers/renderShared'
import { useNavigationDisclosure, useNavigationPathDisclosure } from '@liwan/ui/app/composables/useNavigationDisclosure'

const component = resolve(__dirname, '../MobileNavigation.vue')
const shared = resolve(__dirname, '../../../../../../packages/ui/app/components/shell/ShellNavigation.vue')
const stub = Vue.defineComponent({ setup(_, { slots }) { return () => Vue.h('div', slots.default?.()) } })
const disclosure = Vue.defineComponent({ props: { open: Boolean }, setup(props, { slots }) { return () => Vue.h('div', [slots.default?.(), props.open ? slots.content?.() : null]) } })
const ids = ['apps', 'home', 'tasks', 'projects', 'chat', 'ai', 'settings']
async function render(activeId = 'tasks') {
  const items = ids.map(id => ({ id, label: `nav.${id}`, icon: 'i-lucide-circle', to: id === 'home' ? '/' : `/${id}`, active: id === activeId, sections: ['apps', 'home'].includes(id) ? [] : [{ id: 'main', title: '', items: [] }], views: [], actions: [] }))
  const options = {
    stubs: { UCollapsible: disclosure, UPopover: disclosure, UTooltip: stub, USlideover: Vue.defineComponent({ setup(_, { slots }) { return () => Vue.h('div', [slots.default?.(), slots.body?.()]) } }) },
    globals: {
      useI18n: () => ({ t: (key: string) => key, te: () => false, localeProperties: Vue.ref({ dir: 'rtl' }) }),
      useRoute: () => ({ path: '/tasks', fullPath: '/tasks' }),
      useRouter: () => ({ resolve: (to: string) => ({ fullPath: to }) }),
    },
    modules: {
      '@vueuse/core': { useMediaQuery: () => Vue.ref(false), createReusableTemplate },
      '@/composables/nav/settingsScroll': { isSamePageAnchor: () => false },
      '../../composables/useNavigationDisclosure': { useNavigationDisclosure, useNavigationPathDisclosure },
      './ShellContextSubList.vue': { __esModule: true, default: stub }, './ShellQuickViews.vue': { __esModule: true, default: stub },
      '../shared/layout/BrandWordmark.vue': { __esModule: true, default: stub },
    } as Record<string, unknown>,
  }
  options.modules['@liwan/ui/app/components/shell/ShellNavigation.vue'] = { __esModule: true, default: loadShared(shared, options) }
  return renderShared(component, { items, activeId, homeTo: '/' }, {}, options)
}

describe('MobileNavigation', () => {
  it('renders the same application menu in manifest order inside the drawer', async () => {
    expect([... (await render()).matchAll(/data-testid="mobile-navigation-app-([^" ]+)"/g)].map(match => match[1])).toEqual(ids)
  })
  it('shows the active app as an expandable button rather than a navigation link', async () => {
    const html = await render('chat')
    expect(html).toMatch(/<button[^>]*data-testid="mobile-navigation-app-chat"[^>]*data-active="true"/)
    expect(html).not.toMatch(/<a[^>]*href="\/chat"/)
  })
})
