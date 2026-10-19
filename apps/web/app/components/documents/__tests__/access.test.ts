import { expect, it } from 'vitest'
import { documentAccessPayload } from '../../../lib/documentAccess'
it('rejects removing or demoting the last editor and duplicate grants', () => {
  expect(() => documentAccessPayload(4, 'restricted', [{ user: { id: 7, name: 'Reader' }, access: 'reader' }])).toThrow()
  expect(() => documentAccessPayload(4, 'company', [{ user: { id: 7, name: 'A' }, access: 'editor' }, { user: { id: 7, name: 'A' }, access: 'reader' }])).toThrow()
})
it('uses user ids and a fresh revision for explicit reader/editor grants', () => {
  expect(documentAccessPayload(4, 'restricted', [{ user: { id: 7, name: 'Editor' }, access: 'editor' }, { user: { id: 8, name: 'Reader' }, access: 'reader' }])).toEqual({ expected_revision: 4, visibility: 'restricted', grants: [{ user_id: 7, access: 'editor' }, { user_id: 8, access: 'reader' }] })
})

import { load } from '../../../pages/documents/__tests__/helpers'
it('shows reader/editor grants and disables removing the last editor', async () => {
  const view = await load('app/components/documents/DocumentAccessForm.vue', { access: { revision: 3, visibility: 'restricted', grants: [{ user: { id: 7, name: 'Editor' }, access: 'editor' }] } })
  const nodes = await view.rendered()
  expect(nodes.find(node => node.name === 'UButton' && node.props.icon === 'i-lucide-x')?.props.disabled).toBe(true)
  view.state.resolvePeople([{ id: 9, name: 'Reader' }]); await view.state.submit()
  expect(view.emit).toHaveBeenCalledWith('save', { expected_revision: 3, visibility: 'restricted', grants: [{ user_id: 7, access: 'editor' }, { user_id: 9, access: 'reader' }] })
  view.stop()
})
it('does not reset an access draft or its revision when newer server access arrives', async () => {
  const props = { access: { revision: 3, visibility: 'restricted', grants: [{ user: { id: 7, name: 'Editor' }, access: 'editor' }] } }
  const view = await load('app/components/documents/DocumentAccessForm.vue', props)
  view.state.visibility.value = 'company'; props.access = { ...props.access, revision: 4 }
  await view.state.submit()
  expect(view.emit.mock.calls[0]![1].expected_revision).toBe(3)
  view.stop()
})
