import { h } from 'vue'
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
const render = (props: Record<string, unknown>) => renderShared('ConversationLayout', props, slots)
/** The opening tag of one pane, so its responsive classes can be read without a browser. */
const paneTag = (html: string, name: string) => new RegExp(`<[a-z]+[^>]*data-template="conversation-${name}"[^>]*>`).exec(html)?.[0] ?? ''

describe('ConversationLayout', () => {
  it('paints the same markup on the server and the client: the width is decided in CSS, never by a media query', async () => {
    const html = await render({ hasSelection: true })
    // The two panes exist in the server HTML; a phone hides the list with a breakpoint class instead of the server
    // guessing a width and the client correcting it after hydration.
    expect(html).toContain('data-template="conversation-list"')
    expect(html).toContain('data-template="conversation-thread"')
    expect(paneTag(html, 'list')).toContain('hidden md:flex')
    expect(paneTag(html, 'thread')).toContain('class="min-h-0 min-w-0 flex-col flex"')
  })

  it.each([
    ['nothing selected: the list alone on a phone, the empty thread beside it from 768px', { hasSelection: false }, 'flex', 'hidden md:flex'],
    ['selected: the thread alone on a phone, the list beside it from 768px', { hasSelection: true }, 'hidden md:flex', 'flex'],
    ['selected with info: the panel alone on a phone, the list and the panel from 768px', { hasSelection: true, infoOpen: true }, 'hidden md:flex', 'hidden xl:flex'],
  ] as const)('%s', async (_label, props, listClass, threadClass) => {
    const html = await render(props)
    expect(paneTag(html, 'list')).toContain(listClass)
    expect(paneTag(html, 'thread')).toContain(`class="min-h-0 min-w-0 flex-col ${threadClass}"`)
  })

  it('is one list | 1fr grid, with the info column only from 1280px', async () => {
    expect(await render({ hasSelection: false })).toContain('grid-cols-1 md:grid-cols-[clamp(260px,34vw,360px)_minmax(0,1fr)]')
    expect(await render({ hasSelection: true })).toContain('grid-cols-1 md:grid-cols-[clamp(260px,34vw,360px)_minmax(0,1fr)]')
    expect(await render({ hasSelection: true, infoOpen: true })).toContain('xl:grid-cols-[360px_minmax(0,1fr)_320px]')
  })

  it('stacks header, messages and composer, and puts info in a labelled aside at the inline end', async () => {
    const html = await render({ hasSelection: true, infoOpen: true })
    const order = ['data-header', 'data-thread', 'data-composer', 'data-template="conversation-info"']
    const positions = order.map(marker => html.indexOf(marker))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toMatch(/<aside[^>]*aria-label="states.details"/)
    expect(html).toContain('xl:border-s-[1.5px]')
    expect(html).not.toMatch(/\b(?:border-l|border-r|ml-|mr-)/)
  })

  it('keeps the selected thread mounted while the info panel replaces it', async () => {
    const html = await render({ hasSelection: true, infoOpen: true })
    expect(html).toContain('data-thread')
    expect(html).toContain('data-composer')
    expect(paneTag(html, 'thread')).toContain('hidden xl:flex')
  })

  it('shows the empty state beside the list only from 768px, and ignores info without a selection', async () => {
    const html = await render({ hasSelection: false, infoOpen: true })
    expect(html).toContain('data-empty')
    expect(paneTag(html, 'thread')).toContain('hidden md:flex')
    expect(html).not.toContain('data-template="conversation-info"')
    expect(html).not.toContain('data-header')
  })
})
