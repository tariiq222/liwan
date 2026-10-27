import { describe, expect, it } from 'vitest'
import { load } from '../../documents/__tests__/helpers'

async function open(id: string) {
  const bindings = { definePageMeta: () => {}, useRoute: () => ({ params: { id } }), ChatWorkspace: {} }
  const view = await load('app/pages/chat/[id]/[[panel]].vue', {}, true, { bindings })
  return { view, nodes: await view.rendered() }
}

describe('the conversation page', () => {
  it.each(['abc', '0', '-3', '1.5', '99999999999999999999'])('shows a not-found state with a link back to /chat for the id %s', async (id) => {
    const { view, nodes } = await open(id)
    expect(nodes.some(node => node.name === 'ChatWorkspace')).toBe(false)
    expect(nodes.find(node => node.name === 'SharedNotFoundState')?.props['back-to']).toBe('/chat')
    view.stop()
  })

  it('opens the workspace for a valid id', async () => {
    const { view, nodes } = await open('42')
    expect(nodes.find(node => node.name === 'ChatWorkspace')?.props['conversation-id']).toBe(42)
    expect(nodes.some(node => node.name === 'SharedNotFoundState')).toBe(false)
    view.stop()
  })
})
