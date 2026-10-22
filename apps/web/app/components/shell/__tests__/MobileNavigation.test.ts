import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@webvue/ui/test/helpers/renderShared'
import { railModel, subListSections } from '../../../composables/nav/sidebarModel'
import type { ShellModuleDefinition } from '../../../composables/nav/shellModules'

const component = resolve(__dirname, '../MobileNavigation.vue')
const module = (id: string, extra: Partial<ShellModuleDefinition> = {}): ShellModuleDefinition => ({ id, labelKey: `nav.${id}`, icon: 'i-lucide-circle', to: `/${id}`, ...extra })
const modules = [module('home', { to: '/' }), module('tasks'), module('projects'), module('chat'), module('ai', { utility: true }), module('settings', { utility: true })]
const stub = (tag: string) => Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => Vue.h(tag, attrs, slots.default?.()) } })

function render(activeId: string | null = 'tasks') {
  const route = { path: '/tasks', fullPath: '/tasks' }
  const rail = railModel(modules)
  return renderShared(component, {
    modules: rail.drawer, activeId, title: 'المهام', createLinks: [], sections: [], subSections: [], quickViews: [], quickActions: [],
  }, {}, {
    stubs: {
      USlideover: Vue.defineComponent({ setup(_, { slots }) { return () => Vue.h('div', [slots.default?.(), slots.body?.()]) } }),
      USeparator: stub('hr'),
    },
    globals: {
      useI18n: () => ({ t: (key: string) => key, te: () => false, localeProperties: Vue.ref({ dir: 'rtl' }) }),
      useRoute: () => route,
      useRouter: () => ({ resolve: (to: string) => ({ fullPath: to }) }),
      watch: Vue.watch,
    },
    modules: {
      '@vueuse/core': { useMediaQuery: () => Vue.ref(false) },
      '@/composables/nav/settingsScroll': { isSamePageAnchor: () => false },
      '@/composables/nav/sidebarModel': { subListSections },
      '@webvue/ui/app/components/shell/ShellContextSubList.vue': { __esModule: true, default: stub('div') },
      '@webvue/ui/app/components/shell/ShellQuickViews.vue': { __esModule: true, default: stub('div') },
      '@/components/shell/SidebarCreateAction.vue': { __esModule: true, default: stub('div') },
    },
  })
}

const order = (html: string) => [...html.matchAll(/aria-label="nav\.(\w+)"/g)].map(match => match[1]).filter(id => id !== 'toggleSidebar' && id !== 'modules')

describe('MobileNavigation', () => {
  it('lists every reachable application in the same order as desktop', async () => {
    expect(order(await render())).toEqual(['apps', 'home', 'tasks', 'projects', 'chat', 'ai', 'settings'])
  })
  it('marks only the active application', async () => {
    const html = await render('chat')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="page"[^>]*aria-label="nav\.chat"|aria-label="nav\.chat"[^>]*aria-current="page"/)
  })
})
