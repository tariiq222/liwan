import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mountScript } from './scriptHarness'

const filename = new URL('../InboxConversationActions.vue', import.meta.url)
const base = { id: 3, revision: 2, can_reply: true, can_assign: true, assignee: null, state: 'open', priority: 'normal' }

function mount(conversation: Record<string, unknown> = {}, userId = 1) {
  const save = vi.fn()
  const { state } = mountScript(filename, {
    useMe: () => ({ me: Vue.ref({ id: userId }) }),
    useMediaQuery: () => Vue.ref(true),
    useInboxConversationSave: () => ({ save, patching: Vue.ref(false) }),
    PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  }, { conversation: { ...base, ...conversation } })
  return { state, save }
}

describe('InboxConversationActions', () => {
  it('assigns to the current user in one patch, and only while the conversation is not already theirs', () => {
    const { state, save } = mount()
    expect(state.canAssignToMe).toBe(true)
    state.assignToMe()
    expect(save).toHaveBeenCalledWith({ assignee_id: 1 })
    expect(mount({ assignee: { id: 1 } }).state.canAssignToMe).toBe(false)
    expect(mount({ assignee: { id: 5 } }).state.canAssignToMe).toBe(true)
  })

  it('draws no assign control without the assign capability', () => {
    expect(mount({ can_assign: false }).state.canAssignToMe).toBe(false)
  })

  it('resolves an open conversation and reopens a resolved or closed one', () => {
    const open = mount()
    expect(open.state.stateAction.state).toBe('resolved')
    expect(open.state.stateAction.label).toBe('inbox.actions.resolve')
    open.state.changeState()
    expect(open.save).toHaveBeenCalledWith({ state: 'resolved' })
    for (const state of ['resolved', 'closed']) {
      const reopened = mount({ state })
      expect(reopened.state.stateAction).toMatchObject({ state: 'open', label: 'inbox.actions.reopen' })
      reopened.state.changeState()
      expect(reopened.save).toHaveBeenCalledWith({ state: 'open' })
    }
  })

  it('lists the four priorities with the current one checked and saves another', () => {
    const { state, save } = mount({ priority: 'high' })
    const [priorities] = state.moreItems as Array<Array<{ checked: boolean; onSelect: () => void }>>
    expect(priorities!.map(item => item.checked)).toEqual([false, false, true, false])
    priorities![0]!.onSelect()
    priorities![2]!.onSelect()
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith({ priority: 'low' })
  })

  it('offers unassign only to someone who may assign, and leaves the menu out when nothing is allowed', () => {
    expect(mount({ assignee: { id: 5 } }).state.moreItems).toHaveLength(2)
    expect(mount({ can_assign: false, assignee: { id: 5 } }).state.moreItems).toHaveLength(1)
    const readOnly = mount({ can_reply: false, can_assign: false })
    expect(readOnly.state.showMore).toBe(false)
  })
})
