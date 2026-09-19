import { describe, expect, it } from 'vitest'
import { activeCommentTrigger, declaredReferences, insertCommentReference } from '../commentReferences'

describe('comment references', () => {
  it('opens on @ and / only at a word start and keeps spaces in the query', () => {
    expect(activeCommentTrigger('@', 1)).toEqual({ kind: 'person', start: 0, end: 1, query: '' })
    expect(activeCommentTrigger('راجع @نورة ال', 13)).toEqual({ kind: 'person', start: 5, end: 13, query: 'نورة ال' })
    expect(activeCommentTrigger('see /Fix', 8)).toEqual({ kind: 'task', start: 4, end: 8, query: 'Fix' })
    expect(activeCommentTrigger('mail a@b', 8)).toBeNull()
    expect(activeCommentTrigger('https://x.test/path', 19)).toBeNull()
    expect(activeCommentTrigger('@sara\nnext', 10)).toBeNull()
    expect(activeCommentTrigger('@ sara', 6)).toBeNull()
  })

  it('writes the picked label over the typed query and places the caret after it', () => {
    const text = 'راجع @نو الآن'
    const trigger = activeCommentTrigger(text, 8)!
    const next = insertCommentReference(text, trigger, { kind: 'person', id: 5, label: 'نورة الحربي' })
    expect(next.text).toBe('راجع @نورة الحربي  الآن')
    expect(next.caret).toBe('راجع @نورة الحربي '.length)
  })

  it('declares only references whose token is still in the text', () => {
    const picked = [
      { kind: 'person' as const, id: 5, label: 'Nora' },
      { kind: 'person' as const, id: 6, label: 'Mona' },
      { kind: 'task' as const, id: 9, label: 'Fix login' },
    ]
    expect(declaredReferences('@Nora see /Fix login', picked)).toEqual({ mentions: [5], taskRefs: [9] })
    expect(declaredReferences('nothing', picked)).toEqual({ mentions: [], taskRefs: [] })
  })
})
