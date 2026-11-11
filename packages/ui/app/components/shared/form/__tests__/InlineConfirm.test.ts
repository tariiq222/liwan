import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, type App } from 'vue'
import { createHostNode, findNode, hostRenderer, type HostNode } from '../../../../../test/helpers/hostRenderer'
import { loadShared } from '../../../../../test/helpers/renderShared'

// No DOM here: host nodes stand in for elements, so focus() and querySelector() are given to them for these tests.
const hostProto = Object.getPrototypeOf(createHostNode()) as Record<string, unknown>
const focused: string[] = []
let fieldInSlot: { focus: () => void } | null = null
let mounted: App | null = null

const passthrough = (tag: string) => defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(tag, attrs, slots.default?.()) })
const UAlert = defineComponent({
  inheritAttrs: false,
  setup: (_, { attrs, slots }) => () => h('div', attrs, [slots.description?.(), slots.actions?.()]),
})

function mount(slot?: () => unknown) {
  const InlineConfirm = loadShared('InlineConfirm')
  const app = hostRenderer.createApp(defineComponent({ render: () => h(InlineConfirm, { title: 'Archive?', confirmLabel: 'Archive', onCancel: () => focused.push('cancel-emitted') }, slot ? { default: slot } : {}) }))
  app.component('UAlert', UAlert)
  app.component('UButton', passthrough('button'))
  const host = createHostNode()
  app.mount(host)
  mounted = app
  return host
}

beforeEach(() => {
  focused.length = 0
  fieldInSlot = null
  hostProto.focus = function (this: HostNode) { focused.push(String(this.props['data-testid'])) }
  hostProto.querySelector = () => fieldInSlot
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
  delete hostProto.focus
  hostProto.querySelector = () => null
  delete (globalThis as { document?: unknown }).document
})

describe('SharedInlineConfirm focus', () => {
  it('moves focus to Cancel when it appears and the slot has no field', () => {
    mount()
    expect(focused).toEqual(['inline-confirm-cancel'])
  })

  it('moves focus to the first field of its slot when there is one', () => {
    fieldInSlot = { focus: () => focused.push('slot-field') }
    mount(() => h('input'))
    expect(focused).toEqual(['slot-field'])
  })

  it('returns focus to the control that opened it when Cancel is chosen and that control is in the page', async () => {
    ;(globalThis as { document?: unknown }).document = { activeElement: { isConnected: true, focus: () => focused.push('opener') } }
    const host = mount()
    focused.length = 0
    ;(findNode(host, node => node.props['data-testid'] === 'inline-confirm-cancel')!.props.onClick as () => void)()
    await nextTick()
    expect(focused).toEqual(['cancel-emitted', 'opener'])
  })

  it('leaves focus alone on Cancel when the opening control is gone from the page', async () => {
    ;(globalThis as { document?: unknown }).document = { activeElement: { isConnected: false, focus: () => focused.push('opener') } }
    const host = mount()
    focused.length = 0
    ;(findNode(host, node => node.props['data-testid'] === 'inline-confirm-cancel')!.props.onClick as () => void)()
    await nextTick()
    expect(focused).toEqual(['cancel-emitted'])
  })
})
