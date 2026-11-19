import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'

const filename = resolve(import.meta.dirname, '../InboxChannelOpportunityMode.vue')
const section = Vue.defineComponent({ inheritAttrs: false, props: ['title', 'description'], setup: (props, { attrs, slots }) => () => Vue.h('section', { 'data-testid': attrs['data-testid'] }, [Vue.h('h2', props.title), Vue.h('p', props.description), slots.default?.()]) })
const radios = Vue.defineComponent({
  inheritAttrs: false,
  props: ['modelValue', 'items', 'legend', 'disabled'],
  setup: props => () => Vue.h('fieldset', { 'data-testid': 'group', 'data-value': props.modelValue, 'data-disabled': String(!!props.disabled) }, [
    Vue.h('legend', props.legend),
    ...props.items.map((item: { value: string; label: string; description: string }) => Vue.h('label', { 'data-option': item.value }, `${item.label}|${item.description}`)),
  ]),
})

const messages = {
  'inbox.opportunity.mode.title': 'إنشاء الفرصة من المحادثة الجديدة',
  'inbox.opportunity.mode.hint': 'تلميح',
  'inbox.opportunity.mode.label': 'الوضع',
  'inbox.opportunity.mode.manual': 'يدويًا',
  'inbox.opportunity.mode.manualHint': 'وصف اليدوي',
  'inbox.opportunity.mode.auto_first_message': 'تلقائيًا',
  'inbox.opportunity.mode.autoHint': 'وصف التلقائي',
}

function render({ available = true, mode = 'manual' as string | null, pending = false } = {}) {
  const mutate = vi.fn()
  const html = renderShared(filename, { channelId: 4 }, {}, {
    hydrated: true,
    messages,
    globals: { useToast: () => ({ add: vi.fn() }) },
    modules: {
      '@/composables/useInboxChannelOpportunityMode': {
        useChannelOpportunityModeAccess: () => Vue.ref(available),
        useChannelOpportunityMode: () => ({
          data: Vue.ref(mode ? { channel_id: 4, opportunity_mode: mode } : undefined), error: Vue.ref(null), isPending: Vue.ref(pending), refetch: vi.fn(),
        }),
        usePatchChannelOpportunityMode: () => ({ mutate, isPending: Vue.ref(false) }),
      },
    },
    stubs: { SharedRecordSection: section, URadioGroup: radios },
  })
  return html.then(text => ({ text, mutate }))
}

describe('InboxChannelOpportunityMode', () => {
  it('shows both modes with their descriptions and the stored one selected', async () => {
    const { text } = await render({ mode: 'auto_first_message' })
    expect(text).toContain('إنشاء الفرصة من المحادثة الجديدة')
    expect(text).toContain('data-value="auto_first_message"')
    expect(text).toContain('يدويًا|وصف اليدوي')
    expect(text).toContain('تلقائيًا|وصف التلقائي')
  })

  it('is hidden when CRM is off or the user lacks a capability', async () => {
    expect((await render({ available: false })).text).not.toContain('inbox-channel-opportunity-mode')
  })

  it('waits for the stored value before offering a choice', async () => {
    const { text } = await render({ mode: null, pending: true })
    expect(text).not.toContain('data-testid="group"')
  })
})
