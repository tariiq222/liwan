import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../__tests__/helpers/renderShared'

const stubs = {
  SharedPageContainer: defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => h('div', attrs, slots.default?.()) } }),
}
const slots = {
  list: () => h('ul', { 'data-list': '' }),
  header: () => h('div', { 'data-header': '' }),
  thread: () => h('div', { 'data-thread': '' }),
  composer: () => h('div', { 'data-composer': '' }),
  info: () => h('div', { 'data-info': '' }),
  empty: () => h('p', { 'data-empty': '' }),
}
const renderAt = (width: number, props: Record<string, unknown>, content = slots) => renderShared('ConversationLayout', props, content, {
  stubs,
  modules: { '@vueuse/core': { useMediaQuery: (query: string) => ref(width >= Number(/min-width: (\d+)px/.exec(query)?.[1])) } },
})
const render = (desktop: boolean, props: Record<string, unknown>) => renderAt(desktop ? 1440 : 390, props)
const shown = (html: string) => {
  const visible = html.replace(/<section[^>]*style="[^"]*display:\s*none;?[^"]*"[^>]*>[\s\S]*?<\/section>/g, '')
  return Object.keys(slots).filter(name => new RegExp(`data-${name}(?:=""|[ >])`).test(visible))
}

describe('SharedConversationLayout', () => {
  it.each([
    ['desktop, nothing selected: the list is the sidebar panel, the page shows empty', true, { hasSelection: false }, ['empty']],
    ['desktop, selected', true, { hasSelection: true }, ['header', 'thread', 'composer']],
    ['desktop, selected with info: info beside the thread', true, { hasSelection: true, infoOpen: true }, ['header', 'thread', 'composer', 'info']],
    ['phone, nothing selected: the list fills the page', false, { hasSelection: false }, ['list']],
    ['phone, selected: the thread replaces the list', false, { hasSelection: true }, ['header', 'thread', 'composer']],
    ['phone, selected with info: info replaces the thread', false, { hasSelection: true, infoOpen: true }, ['info']],
    ['info without a selection is ignored', true, { hasSelection: false, infoOpen: true }, ['empty']],
  ] as const)('%s', async (_label, desktop, props, expected) => {
    expect(shown(await render(desktop, props))).toEqual(expected)
  })

  it('stacks header, messages and composer, and puts info in a labelled aside at the inline end', async () => {
    const html = await render(true, { hasSelection: true, infoOpen: true })
    const order = ['data-header', 'data-thread', 'data-composer', 'data-template="conversation-info"']
    const positions = order.map(marker => html.indexOf(marker))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toMatch(/<aside[^>]*aria-label="states.details"/)
    expect(html).toContain('md:border-s')
    expect(html).not.toMatch(/\b(?:border-l|border-r|ml-|mr-)/)
  })

  it('fills the height under the shell header', async () => {
    const html = await render(true, { hasSelection: false })
    expect(html).toContain('h-[calc(100svh_-_var(--shell-header-height,0px))]')
  })
})

describe('conversation info at tablet widths', () => {
  it.each([768, 1024])('at %ipx info takes the available region instead of squeezing the thread', async width => {
    expect(shown(await renderAt(width, { hasSelection: true, infoOpen: true }))).toEqual(['info'])
    expect(shown(await renderAt(width, { hasSelection: true }))).toEqual(['header', 'thread', 'composer'])
  })

  it.each([[768, 'h1'], [1024, 'h1'], [1440, 'h2']] as const)('at %ipx the info slot receives %s', async (width, heading) => {
    const info = (props: { headingLevel?: string } = {}) => h(props.headingLevel ?? 'h2', { 'data-info': '' })
    const html = await renderAt(width, { hasSelection: true, infoOpen: true }, { ...slots, info })
    expect(html).toContain(`<${heading} data-info`)
  })
})

it.each([390, 768, 1024])('info at %ipx hides but retains the selected thread instance', async width => {
  const html = await renderAt(width, { hasSelection: true, infoOpen: true })
  expect(html).toMatch(/<section[^>]*data-template="conversation-thread"[^>]*style="[^"]*display:\s*none/)
  expect(html).toContain('data-thread')
  expect(shown(html)).toEqual(['info'])
})
