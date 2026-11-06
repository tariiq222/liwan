import * as Vue from 'vue'
import { expect, it } from 'vitest'
import { DEFAULT_STUBS, loadShared, renderShared } from './helpers/renderShared'
import { hostRenderer, createHostNode, findNodes } from './helpers/hostRenderer'
import * as dataTable from '../app/utils/dataTable'

const Pass = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('section', slots.default?.()) })
const Table = Vue.defineComponent({ props: ['data'], setup: props => () => Vue.h('table', (props.data as any[]).map(row => Vue.h('tr', row.name))) })
const rows = Array.from({ length: 20 }, (_, index) => ({ id: index, name: `Row ${index}` }))
function options(hydrated: Vue.Ref<boolean>, wide: Vue.Ref<boolean>) {
  return {
    globals: { useHydrated: () => hydrated },
    modules: {
      '@vueuse/core': { useMediaQuery: () => wide },
      '../../../composables/useRowNavigation': { useRowNavigation: () => {} },
      '../../../utils/dataTable': { ...dataTable, markTableRows: () => {}, markSortHeaders: () => {} },
      '../feedback/PageState.vue': { __esModule: true, default: Pass },
      './Pagination.vue': { __esModule: true, default: Pass },
    },
    stubs: { UTable: Table, UCheckbox: Pass },
  }
}
it('SSR constructs 20 desktop rows without a second hidden 20-row mobile tree', async () => {
  let mobileSlots = 0
  const html = await renderShared('DataTable', { rows, columns: [], rowKey: 'id', caption: 'Requests' }, {
    'mobile-row': () => { mobileSlots++; return Vue.h('span', 'Mobile row') },
  }, options(Vue.ref(false), Vue.ref(false)))
  expect((html.match(/<tr>/g) ?? []).length).toBe(20)
  expect(mobileSlots).toBe(0)
  expect(html).not.toContain('hidden md:block')
})
it('constructs only the selected layout after mount and responds to viewport resize', async () => {
  const hydrated = Vue.ref(true)
  const wide = Vue.ref(false)
  const component = loadShared('DataTable', options(hydrated, wide))
  let mobileSlots = 0
  const root = createHostNode()
  const app = hostRenderer.createApp({ render: () => Vue.h(component, { rows, columns: [], rowKey: 'id', caption: 'Requests' }, {
    'mobile-row': ({ row }: any) => { mobileSlots++; return Vue.h('a', { href: `/rows/${row.id}` }, row.name) },
  }) })
  for (const [name, stub] of Object.entries({ ...DEFAULT_STUBS, UTable: Table, UCheckbox: Pass })) app.component(name, stub)
  app.mount(root)
  await Vue.nextTick()
  expect(findNodes(root, node => node.type === 'table')).toHaveLength(0)
  expect(findNodes(root, node => node.type === 'li')).toHaveLength(20)
  expect(mobileSlots).toBe(20)
  wide.value = true
  await Vue.nextTick(); await Vue.nextTick()
  expect(findNodes(root, node => node.type === 'table')).toHaveLength(1)
  expect(findNodes(root, node => node.type === 'li')).toHaveLength(0)
  wide.value = false
  await Vue.nextTick(); await Vue.nextTick()
  expect(findNodes(root, node => node.type === 'table')).toHaveLength(0)
  expect(findNodes(root, node => node.type === 'a')).toHaveLength(20)
  app.unmount()
})
