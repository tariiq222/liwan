import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import * as avatarTone from '../../../../utils/avatarTone'
import { renderShared } from '../../../../../test/helpers/renderShared'

const UAvatar = Vue.defineComponent({
  inheritAttrs: false,
  props: { text: String, src: String },
  setup(props, { attrs }) { return () => Vue.h('i', { ...attrs, 'data-avatar': props.src ? 'photo' : 'initials' }, props.text) },
})
const people = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `Person ${index + 1}` }))
const render = (list: { id: number; name: string; src?: string }[]) =>
  renderShared('PersonAvatar', { people: list }, {}, { modules: { '../../../utils/avatarTone': avatarTone }, stubs: { UAvatar } })

describe('SharedPersonAvatar', () => {
  it('shows one avatar and no chip for a single person', async () => {
    const html = await render(people(1))
    expect(html.match(/data-avatar/g)).toHaveLength(1)
    expect(html).not.toContain('avatar-more')
  })

  it('stacks up to three avatars, overlapped with a logical margin, the first on top', async () => {
    const html = await render(people(3))
    expect(html.match(/data-avatar/g)).toHaveLength(3)
    expect(html.match(/-ms-\[0\.571rem\]/g)).toHaveLength(2)
    expect(html).toMatch(/z-index:\s*3[^>]*>[\s\S]*z-index:\s*1/)
    expect(html).not.toContain('avatar-more')
  })

  it('shows three avatars and +1 for four people, and +N for the rest', async () => {
    expect(await render(people(4))).toMatch(/avatar-more[^>]*>\+1</)
    expect(await render(people(7))).toMatch(/avatar-more[^>]*>\+4</)
  })

  it('lists every name once for the whole group and renders a photo when given', async () => {
    const html = await render([{ id: 1, name: 'Sara', src: 'data:image/png;base64,x' }, { id: 2, name: 'Omar' }])
    expect(html).toContain('title="Sara، Omar"')
    expect(html).toContain('aria-label="Sara، Omar"')
    expect(html).toContain('data-avatar="photo"')
    expect(html).toContain('data-avatar="initials"')
  })
})
