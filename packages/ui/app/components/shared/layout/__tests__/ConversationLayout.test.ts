import { h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '../../../../../test/helpers/renderShared'

const slots = {
  list: () => h('ul', { 'data-list': '' }),
  header: () => h('div', { 'data-header': '' }),
  thread: () => h('div', { 'data-thread': '' }),
  composer: () => h('div', { 'data-composer': '' }),
  info: () => h('div', { 'data-info': '' }),
  empty: () => h('p', { 'data-empty': '' }),
}
const renderAt = (width: number, props: Record<string, unknown>, content = slots) => renderShared('ConversationLayout', props, content, {
  modules: { '@vueuse/core': { useMediaQuery: (query: string) => ref(width >= Number(/min-width: (\d+)px/.exec(query)?.[1])) } },
})
const render = (desktop: boolean, props: Record<string, unknown>) => renderAt(desktop ? 1440 : 390, props)
const shown = (html: string) => {
  const visible = html.replace(/<section[^>]*style="[^"]*display:\s*none;?[^"]*"[^>]*>[\s\S]*?<\/section>/g, '')
  return Object.keys(slots).filter(name => new RegExp(`data-${name}(?:=""|[ >])`).test(visible))
}

describe('ConversationLayout', () => {
  it.each([
    ['desktop, nothing selected: the list and the empty state', true, { hasSelection: false }, ['list', 'empty']],
    ['desktop, selected', true, { hasSelection: true }, ['list', 'header', 'thread', 'composer']],
    ['desktop, selected with info: info beside the thread', true, { hasSelection: true, infoOpen: true }, ['list', 'header', 'thread', 'composer', 'info']],
    ['phone, nothing selected: the list fills the page', false, { hasSelection: false }, ['list']],
    ['phone, selected: the thread replaces the list', false, { hasSelection: true }, ['header', 'thread', 'composer']],
    ['phone, selected with info: info replaces the thread', false, { hasSelection: true, infoOpen: true }, ['info']],
    ['info without a selection is ignored', true, { hasSelection: false, infoOpen: true }, ['list', 'empty']],
  ] as const)('%s', async (_label, desktop, props, expected) => {
    expect(shown(await render(desktop, props))).toEqual(expected)
  })

  it('stacks header, messages and composer, and puts info in a labelled aside at the inline end', async () => {
    const html = await render(true, { hasSelection: true, infoOpen: true })
    const order = ['data-header', 'data-thread', 'data-composer', 'data-template="conversation-info"']
    const positions = order.map(marker => html.indexOf(marker))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toMatch(/<aside[^>]*aria-label="states.details"/)
    expect(html).toContain('border-s-[1.5px]')
    expect(html).not.toMatch(/\b(?:border-l|border-r|ml-|mr-)/)
  })

  it('is one 360px | 1fr frame, with the info column from 1280px', async () => {
    expect(await renderAt(1024, { hasSelection: true, infoOpen: true })).toContain('grid-cols-[360px_minmax(0,1fr)]')
    expect(await renderAt(1440, { hasSelection: true, infoOpen: true })).toContain('grid-cols-[360px_minmax(0,1fr)_320px]')
    expect(await renderAt(390, { hasSelection: true })).toContain('grid-cols-1')
  })
})

describe('conversation info at tablet widths', () => {
  it.each([768, 1024])('at %ipx info takes the available region instead of squeezing the thread', async width => {
    expect(shown(await renderAt(width, { hasSelection: true, infoOpen: true }))).toEqual(['list', 'info'])
    expect(shown(await renderAt(width, { hasSelection: true }))).toEqual(['list', 'header', 'thread', 'composer'])
  })
})

it.each([390, 768, 1024])('info at %ipx hides but retains the selected thread instance', async width => {
  const html = await renderAt(width, { hasSelection: true, infoOpen: true })
  expect(html).toMatch(/<section[^>]*data-template="conversation-thread"[^>]*style="[^"]*display:\s*none/)
  expect(html).toContain('data-thread')
  expect(shown(html)).toEqual(width >= 768 ? ['list', 'info'] : ['info'])
})
