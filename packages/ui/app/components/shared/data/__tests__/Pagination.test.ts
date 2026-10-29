import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

// UPagination is a Nuxt UI component; the stub renders the slots the way it does, with page 2 current.
const UPagination = Vue.defineComponent({
  inheritAttrs: false,
  setup(_, { slots }) {
    return () => Vue.h('div', [
      slots.first?.(), slots.prev?.(),
      slots.item?.({ item: { type: 'page', value: 1 }, page: 2 }), slots.item?.({ item: { type: 'page', value: 2 }, page: 2 }),
      slots.next?.(), slots.last?.(),
    ])
  },
})
const messages = {
  'app.pageFirst': 'الصفحة الأولى', 'app.pagePrevious': 'الصفحة السابقة', 'app.pageNext': 'الصفحة التالية',
  'app.pageLast': 'الصفحة الأخيرة', 'app.pageNumber': 'صفحة {page}',
}
const render = (props: Record<string, unknown>) => renderShared('Pagination', props, {}, { messages, stubs: { UPagination } })

describe('SharedPagination', () => {
  it('labels every control through the locale instead of the English Reka defaults', async () => {
    const html = await render({ page: 2, pages: 5 })
    for (const label of ['الصفحة الأولى', 'الصفحة السابقة', 'الصفحة التالية', 'الصفحة الأخيرة', 'صفحة 1', 'صفحة 2']) {
      expect(html, label).toContain(`aria-label="${label}"`)
    }
    expect(html).not.toMatch(/Next Page|Last Page|Page \d/)
    expect(html).toContain('aria-current="page"')
  })

  it('points the chevrons along the reading direction (RTL here)', async () => {
    const html = await render({ page: 2, pages: 5 })
    expect(html).toContain('i-lucide-chevrons-right')
    expect(html).toContain('i-lucide-chevron-left')
  })

  it('draws nothing when everything fits on one page', async () => {
    expect(await render({ page: 1, pages: 1 })).not.toContain('shared-pagination')
  })
})
