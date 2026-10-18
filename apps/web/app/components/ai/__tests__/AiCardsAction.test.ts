import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'

// A thread holds one `action` block: the newest pending card. An older pending card is tinted, a resolved one is a quiet line.
const stubs = {
  ...DEFAULT_STUBS,
  SharedRecordSection: Vue.defineComponent({
    inheritAttrs: false,
    props: { variant: String },
    setup(props, { attrs, slots }) { return () => Vue.h('section', { ...attrs, 'data-variant': props.variant }, slots.default?.()) },
  }),
  AiResolvedLine: Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs }) { return () => Vue.h('p', { ...attrs, 'data-resolved': '' }) } }),
}
const card = (name: 'AiConfirmCard' | 'AiDraftCard', props: Record<string, unknown>) =>
  renderShared(resolve(import.meta.dirname, `../${name}.vue`), { summary: 's', ...props }, {}, { stubs })

describe.each(['AiConfirmCard', 'AiDraftCard'] as const)('%s', (name) => {
  it('is the action block when it is the latest pending card (the default)', async () => {
    expect(await card(name, { state: 'pending' })).toContain('data-variant="action"')
    expect(await card(name, { state: 'pending', latest: true })).toContain('data-variant="action"')
  })

  it('is tinted when an older pending card', async () => {
    const html = await card(name, { state: 'pending', latest: false })
    expect(html).toContain('data-variant="tinted"')
    expect(html).not.toContain('data-variant="action"')
  })

  it('is a quiet resolved line once decided, whatever latest says', async () => {
    const html = await card(name, { state: 'approved', latest: true })
    expect(html).toContain('data-resolved')
    expect(html).not.toContain('data-variant')
  })
})
