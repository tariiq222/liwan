import { resolve } from 'node:path'
import * as Vue from 'vue'
import { useQuery, QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { renderToString } from '@vue/server-renderer'
import { expect, it } from 'vitest'
import { loadShared, DEFAULT_STUBS } from '../../../../../../packages/ui/test/helpers/renderShared'
import { createHostNode, hostRenderer } from '../../../../../../packages/ui/test/helpers/hostRenderer'
import { settleServerQueries } from '../../../lib/vueQuerySsr'
import { ApiError } from '../../../composables/useApi'

function fixture() {
  let requests = 0
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const component = loadShared(resolve(import.meta.dirname, '../NotificationCenter.vue'), {
    modules: {
      '@/utils/listFormat': { joinList: () => '' },
      '@/composables/useApi': { ApiError },
      '@/composables/useNotifications': {
        useNotifications: (enabled = true) => useQuery({ queryKey: ['notifications'], enabled, queryFn: async () => { requests++; return { items: [], unread_count: 0 } } }),
        useMarkNotificationRead: () => ({ mutateAsync: () => {}, isPending: Vue.ref(false) }),
      },
      '@/modules/surfaces': {}, '@/utils/bellTitle': {}, '@/utils/notificationPresentation': {},
    },
    globals: {
      useHydrated: () => { const ready = Vue.ref(false); Vue.onMounted(() => { ready.value = true }); return ready },
      useMe: () => ({ me: Vue.ref(null) }), useToast: () => ({ add: () => {} }), useRoute: () => ({ fullPath: '/' }),
    },
  })
  const popover = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })
  function install(app: Vue.App) {
    app.use(VueQueryPlugin, { queryClient })
    for (const [name, stub] of Object.entries({ ...DEFAULT_STUBS, UPopover: popover })) app.component(name, stub)
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
