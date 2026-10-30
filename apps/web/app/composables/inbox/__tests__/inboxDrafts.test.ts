import { describe, expect, it } from 'vitest'
import { createInboxDrafts, emptyInboxDraft } from '../inboxDrafts'
import { emptyInteractiveDraft } from '../inboxInteractive'

function drafts() {
  const store = new Map<string, string>()
  return { store, api: createInboxDrafts(() => ({ getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: k => void store.delete(k), key: i => [...store.keys()][i] ?? null, length: store.size })) }
}

describe('inbox drafts', () => {
  it('keeps a draft per user and conversation', () => {
    const { api } = drafts()
    api.set(1, 10, { ...emptyInboxDraft(), reply: 'a' })
    expect(api.get(1, 10).reply).toBe('a')
    expect(api.get(1, 11).reply).toBe('')
    expect(api.get(2, 10).reply).toBe('')
  })

  it('removes the entry once everything is empty', () => {
    const { api, store } = drafts()
    api.set(1, 10, { ...emptyInboxDraft(), reply: 'a' })
    api.set(1, 10, { ...emptyInboxDraft(), params: [''] })
    expect(store.size).toBe(0)
  })

  it('reads a damaged entry as empty and clears only inbox drafts', () => {
    const { api, store } = drafts()
    store.set('liwan.inbox.draft.1.10', '{broken')
    store.set('liwan.chat.draft.1.10', 'keep')
    expect(api.get(1, 10)).toEqual(emptyInboxDraft())
    api.clear()
    expect([...store.keys()]).toEqual(['liwan.chat.draft.1.10'])
  })

  it('survives blocked storage', () => {
    const api = createInboxDrafts(() => { throw new Error('blocked') })
    expect(() => api.set(1, 1, { ...emptyInboxDraft(), reply: 'x' })).not.toThrow()
    expect(api.get(1, 1).reply).toBe('')
  })
})

describe('inbox drafts of the messaging kinds', () => {
  it('keeps the quoted message, a location and an interactive message per conversation', () => {
    const { api } = drafts()
    const interactive = { ...emptyInteractiveDraft(), body: 'اختر', buttons: ['نعم', 'لا'] }
    api.set(1, 10, { ...emptyInboxDraft(), replyTo: { id: 4, preview: 'مرحبا' }, location: { latitude: '24.7', longitude: '46.6', name: '', address: '' }, interactive })
    expect(api.get(1, 10)).toMatchObject({ replyTo: { id: 4, preview: 'مرحبا' }, location: { latitude: '24.7' }, interactive: { body: 'اختر', buttons: ['نعم', 'لا'] } })
    expect(api.get(1, 11).replyTo).toBeNull()
  })

  it('reads damaged messaging fields as absent', () => {
    const { api, store } = drafts()
    store.set('liwan.inbox.draft.1.10', JSON.stringify({ reply: 'x', replyTo: { id: 'no' }, location: 5, interactive: { type: 'bogus' } }))
    expect(api.get(1, 10)).toEqual({ ...emptyInboxDraft(), reply: 'x' })
  })
})
