import { describe, expect, it } from 'vitest'
import { createInboxDrafts } from '../inboxDrafts'

function drafts() {
  const store = new Map<string, string>()
  return { store, api: createInboxDrafts(() => ({ getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: k => void store.delete(k), key: i => [...store.keys()][i] ?? null, length: store.size })) }
}

describe('inbox drafts', () => {
  it('keeps a draft per user and conversation', () => {
    const { api } = drafts()
    api.set(1, 10, { reply: 'a', note: '', templateId: null, params: [] })
    expect(api.get(1, 10).reply).toBe('a')
    expect(api.get(1, 11).reply).toBe('')
    expect(api.get(2, 10).reply).toBe('')
  })

  it('removes the entry once everything is empty', () => {
    const { api, store } = drafts()
    api.set(1, 10, { reply: 'a', note: '', templateId: null, params: [] })
    api.set(1, 10, { reply: '', note: '', templateId: null, params: [''] })
    expect(store.size).toBe(0)
  })

  it('reads a damaged entry as empty and clears only inbox drafts', () => {
    const { api, store } = drafts()
    store.set('webvue.inbox.draft.1.10', '{broken')
    store.set('webvue.chat.draft.1.10', 'keep')
    expect(api.get(1, 10)).toEqual({ reply: '', note: '', templateId: null, params: [] })
    api.clear()
    expect([...store.keys()]).toEqual(['webvue.chat.draft.1.10'])
  })

  it('survives blocked storage', () => {
    const api = createInboxDrafts(() => { throw new Error('blocked') })
    expect(() => api.set(1, 1, { reply: 'x', note: '', templateId: null, params: [] })).not.toThrow()
    expect(api.get(1, 1).reply).toBe('')
  })
})
