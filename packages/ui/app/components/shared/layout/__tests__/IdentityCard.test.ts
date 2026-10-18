import * as Vue from 'vue'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import * as avatarTone from '../../../../utils/avatarTone'
import { DEFAULT_STUBS, renderShared } from '../../../../../test/helpers/renderShared'

const stubs = {
  SharedRecordSection: Vue.defineComponent({
    inheritAttrs: false,
    props: { variant: String },
    setup(props, { attrs, slots }) { return () => h('section', { ...attrs, 'data-variant': props.variant }, slots.default?.()) },
  }),
  UAvatar: Vue.defineComponent({
    inheritAttrs: false,
    setup(_, { attrs }) { return () => h('span', { 'data-avatar': attrs.size, 'data-text': attrs.text }) },
  }),
  ...DEFAULT_STUBS,
}

const modules = { '../../../utils/avatarTone': avatarTone }

describe('SharedIdentityCard', () => {
  it('is one panel card with an xl avatar, the name, and the sub-line text', async () => {
    const html = await renderShared('IdentityCard', { id: 7, name: 'Sara', subtitle: 'Designer' }, {}, { stubs, modules })
    expect(html).toContain('data-slot="identity-card"')
    expect(html).toContain('data-variant="panel"')
    expect(html).toContain('data-avatar="xl"')
    expect(html).toContain('text-base font-semibold text-highlighted')
    expect(html).toContain('Sara')
    expect(html).toContain('Designer')
  })

  it('shows the badge slot beside the name and the subtitle slot over the prop', async () => {
    const html = await renderShared('IdentityCard', { id: 1, name: 'Sara', subtitle: 'prop' }, {
      badge: () => h('i', 'BADGE'),
      subtitle: () => h('bdi', 'SLOT'),
    }, { stubs, modules })
    expect(html).toContain('<i>BADGE</i>')
    expect(html).toContain('<bdi>SLOT</bdi>')
    expect(html).not.toContain('prop')
  })

  it('omits the sub-line when there is neither text nor slot', async () => {
    const html = await renderShared('IdentityCard', { id: 1, name: 'Sara' }, {}, { stubs, modules })
    expect(html).not.toContain('text-sm text-muted')
  })
})
