import { resolve } from 'node:path'
import * as Vue from 'vue'
import { useQuery, QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { renderToString } from '@vue/server-renderer'
import { expect, it } from 'vitest'
import { loadShared, DEFAULT_STUBS } from '../../../../../../packages/ui/test/helpers/renderShared'
import { createHostNode, hostRenderer } from '../../../../../../packages/ui/test/helpers/hostRenderer'
import { settleServerQueries } from '../../../lib/vueQuerySsr'

function fixture() {
  let requests = 0
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const component = loadShared(resolve(import.meta.dirname, '../NotificationCenter.vue'), {
    modules: {
      '@/utils/listFormat': { joinList: () => '' },
      '@/composables/useNotifications': {
        useNotifications: (enabled = true) => useQuery({ queryKey: ['notifications'], enabled, queryFn: async () => { requests++; return { items: [], unread_count: 0 } } }),
      },
      '@/composables/useSlideOver': { NOTIFICATIONS_PANEL: 'notifications', slideOverId: (id: string) => `slide-over-${id}`, useSlideOver: () => ({ open: Vue.ref(null), toggle: () => {} }) },
    },
    globals: {
      useHydrated: () => { const ready = Vue.ref(false); Vue.onMounted(() => { ready.value = true }); return ready },
    },
  })
  // The shared bell button, reduced to the attributes the test reads.
  const tool = Vue.defineComponent({ inheritAttrs: false, props: { disabled: Boolean, badge: { type: [Number, String], default: null }, badgeTestId: String }, setup: (props, { attrs }) => () => Vue.h('button', { ...attrs, disabled: props.disabled }, props.badge ? Vue.h('span', { 'data-testid': props.badgeTestId }) : undefined) })
  function install(app: Vue.App) {
    app.use(VueQueryPlugin, { queryClient })
    for (const [name, stub] of Object.entries({ ...DEFAULT_STUBS, ShellToolButton: tool })) app.component(name, stub)
  }
  return { component, queryClient, install, count: () => requests }
}

it('closed bell contributes no pending request to the SSR settlement boundary', async () => {
  const view = fixture()
  const app = Vue.createSSRApp(view.component)
  view.install(app)
  app.mixin({ serverPrefetch: () => settleServerQueries(view.queryClient) })
  const html = await renderToString(app)
  expect(view.count()).toBe(0)
  expect(html).toContain('notification-bell')
  expect(html).toContain('disabled')
  expect(html).not.toContain('notification-count')
  view.queryClient.clear()
})
it('starts the badge request after the client bell has mounted', async () => {
  const view = fixture()
  const app = hostRenderer.createApp(view.component)
  view.install(app)
  app.mount(createHostNode())
  await Vue.nextTick(); await Promise.resolve()
  expect(view.count()).toBe(1)
  app.unmount(); view.queryClient.clear()
})
