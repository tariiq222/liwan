import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import type { InboxTemplate } from '@liwan/contracts'
import { isPayLinkTemplate } from '../../../composables/inbox/inboxCommerce'
import { mountScript } from './scriptHarness'

const file = new URL('../InboxTemplatePicker.vue', import.meta.url)
const template = (id: number, rest: Partial<InboxTemplate> = {}) => ({ id, name: `t${id}`, language: 'ar', category: 'utility', status: 'approved', supported: true, buttons: [], ...rest }) as InboxTemplate

// The server holds 120 templates and returns the first 50 whose name matches `q`; template 99 is past the first page.
const ALL = Array.from({ length: 120 }, (_, index) => template(index + 1))
const PAY = template(99, { buttons: [{ type: 'url', text: 'Pay', url: 'https://x.test/pay/order/{{1}}' } as InboxTemplate['buttons'][number]] })

function mountPicker(props: Record<string, unknown> = {}) {
  const requests: Array<Record<string, unknown>> = []
  const byId = [...ALL.filter(item => item.id !== 99), PAY]
  const bindings = {
    InboxTemplatePicker: {}, refDebounced: <T>(source: Vue.Ref<T>) => source,
    useInboxChannelTemplates: (_channel: unknown, filters: Vue.ComputedRef<{ q: string; limit: number }>) => {
      const data = Vue.computed(() => {
        requests.push({ ...filters.value })
        const matches = byId.filter(item => item.name.includes(filters.value.q))
        return { items: matches.slice(0, filters.value.limit), total: matches.length }
      })
      return { data, isSuccess: Vue.ref(true), isFetching: Vue.ref(false), isError: Vue.ref(false), refetch: () => {} }
    },
    useInboxTemplate: (id: Vue.Ref<number | null>) => ({ data: Vue.computed(() => byId.find(item => item.id === id.value) ?? undefined) }),
  }
  return { ...mountScript(file, bindings, { modelValue: null, template: null, channelId: 1, ...props }), requests }
}

describe('InboxTemplatePicker', () => {
  it('asks the server for one page of approved templates matching the typed name', () => {
    const { state, requests } = mountPicker()
    expect(state.items).toHaveLength(50)
    expect(state.more).toBe(true)
    state.search = ' t9 '
    expect(state.items.length).toBeGreaterThan(0)
    expect(requests.at(-1)).toEqual({ status: 'approved', q: 't9', limit: 50 })
    expect(requests[0]).toEqual({ status: 'approved', q: '', limit: 50 })
  })

  it('reaches a template that is not on the first page by searching for it', () => {
    const { state } = mountPicker()
    expect(state.items.some((item: { value: number }) => item.value === 99)).toBe(false)
    state.search = 't99'
    expect(state.items.map((item: { value: number }) => item.value)).toEqual([99])
  })

  it('keeps the chosen template shown and handed back when it is not on the page', () => {
    const { state, props } = mountPicker({ modelValue: 99 })
    expect(state.items[0]).toMatchObject({ value: 99 })
    expect(props.template).toMatchObject({ id: 99 })
    state.search = 't1'
    expect(state.items[0]).toMatchObject({ value: 99 })
  })

  it('filters the page it received and says so when the page may hide more matches', () => {
    const { state } = mountPicker({ accept: isPayLinkTemplate })
    expect(state.items).toEqual([])
    expect(state.more).toBe(true)
    expect(state.empty).toBe(false)
    state.search = 't99'
    expect(state.items.map((item: { value: number }) => item.value)).toEqual([99])
  })

  it('is empty only when nothing matches and nothing more exists', () => {
    const { state } = mountPicker({ accept: () => false })
    state.search = 't99'
    expect(state.items).toEqual([])
    expect(state.more).toBe(false)
    state.search = ''
    expect(state.empty).toBe(false)
  })
})
