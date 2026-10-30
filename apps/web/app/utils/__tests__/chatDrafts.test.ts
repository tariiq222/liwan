import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createChatDrafts } from '../chatDrafts'

function memoryStorage() {
  const map = new Map<string, string>()
  return { map, get length() { return map.size }, key: (i: number) => [...map.keys()][i] ?? null, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }
}

describe('chatDrafts', () => {
  it('keeps one draft per user and conversation and restores it', () => {
    const drafts = createChatDrafts(() => memoryStorage())
    const store = memoryStorage()
    const shared = createChatDrafts(() => store)
    shared.set(1, 10, 'first')
    shared.set(1, 11, 'second')
    shared.set(2, 10, 'other user')
    expect(shared.get(1, 10)).toBe('first')
    expect(shared.get(1, 11)).toBe('second')
    expect(shared.get(2, 10)).toBe('other user')
    expect(drafts.get(1, 99)).toBe('')
  })
  it('clears the draft when the text becomes empty (after a send)', () => {
    const store = memoryStorage()
    const drafts = createChatDrafts(() => store)
    drafts.set(1, 10, 'text')
    drafts.set(1, 10, '')
    expect(store.map.size).toBe(0)
    expect(drafts.get(1, 10)).toBe('')
  })
  it('works without storage and when storage throws', () => {
    const none = createChatDrafts(() => undefined)
    none.set(1, 10, 'x')
    expect(none.get(1, 10)).toBe('')
    const blocked = createChatDrafts(() => { throw new Error('blocked') })
    expect(() => blocked.set(1, 10, 'x')).not.toThrow()
    expect(blocked.get(1, 10)).toBe('')
  })

  it('clear removes every chat draft and nothing else', () => {
    const store = memoryStorage()
    const drafts = createChatDrafts(() => store)
    drafts.set(1, 10, 'a')
    drafts.set(2, 11, 'b')
    store.setItem('liwan-nav:1', 'keep')
    drafts.clear()
    expect([...store.map.keys()]).toEqual(['liwan-nav:1'])
    expect(() => createChatDrafts(() => { throw new Error('blocked') }).clear()).not.toThrow()
  })
  it('is cleared at logout and when the session expires', () => {
    for (const file of ['../../pages/account/settings.vue', '../../plugins/vue-query.ts']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8'), file).toContain('clearChatDrafts()')
    }
  })
})
