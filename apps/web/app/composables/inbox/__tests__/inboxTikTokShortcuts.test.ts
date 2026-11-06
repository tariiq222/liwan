import { describe, expect, it } from 'vitest'
import type { InboxTikTokShortcut } from '@liwan/contracts'
import {
  buildShortcut, emptyShortcutDraft, nextShortcutSequence, shortcutEditBlocked, shortcutLimitReached, shortcutToDraft,
} from '../inboxTikTokShortcuts'

const shortcut = (overrides: Partial<InboxTikTokShortcut> = {}): InboxTikTokShortcut => ({
  id: 1, kind: 'question', sequence: 0, question: 'ما مواعيد العمل؟', answer: 'من 9 إلى 5.', title: null, content: null,
  provider_id: null, audit: 'draft', sync_error: null, ...overrides,
})

describe('shortcut limits', () => {
  it('counts the items of the kind against TikTok limits', () => {
    const questions = [shortcut(), shortcut({ id: 2 }), shortcut({ id: 3 })]
    expect(shortcutLimitReached('question', questions.slice(0, 2))).toBe(false)
    expect(shortcutLimitReached('question', questions)).toBe(true)
    expect(shortcutLimitReached('prompt', questions)).toBe(false)
    expect(shortcutLimitReached('prompt', Array.from({ length: 6 }, (_, index) => shortcut({ id: index + 1, kind: 'prompt' })))).toBe(true)
  })
})

describe('shortcut editing', () => {
  it('refuses to edit an item TikTok is still reviewing', () => {
    expect(shortcutEditBlocked(shortcut({ audit: 'reviewing' }))).toBe(true)
    for (const audit of ['draft', 'approved', 'rejected'] as const) {
      expect(shortcutEditBlocked(shortcut({ audit }))).toBe(false)
    }
  })

  it('reads a stored item back into the form of its kind', () => {
    expect(shortcutToDraft(shortcut({ sequence: 3 }))).toMatchObject({ kind: 'question', sequence: 3, question: 'ما مواعيد العمل؟', answer: 'من 9 إلى 5.' })
    expect(shortcutToDraft(shortcut({ kind: 'prompt', title: 'العروض', content: 'ما أحدث العروض؟' }))).toMatchObject({ kind: 'prompt', title: 'العروض', content: 'ما أحدث العروض؟' })
  })
})

describe('building a shortcut', () => {
  it('sends the fields of the kind only', () => {
    expect(buildShortcut({ ...emptyShortcutDraft('question'), question: ' ما مواعيد العمل؟ ', answer: 'من 9 إلى 5.' })).toEqual({
      kind: 'question', question: 'ما مواعيد العمل؟', answer: 'من 9 إلى 5.',
    })
    expect(buildShortcut({ ...emptyShortcutDraft('prompt'), title: ' العروض ', content: 'ما أحدث العروض؟' })).toEqual({
      kind: 'prompt', title: 'العروض', content: 'ما أحدث العروض؟',
    })
  })

  it('keeps the sequence when one is set', () => {
    expect(buildShortcut({ ...emptyShortcutDraft('question'), sequence: 2, question: 'سؤال', answer: 'جواب' })).toMatchObject({ sequence: 2 })
  })

  it.each([
    ['a question over 80 characters', { ...emptyShortcutDraft('question'), question: 'س'.repeat(81), answer: 'جواب' }],
    ['an answer over 200 characters', { ...emptyShortcutDraft('question'), question: 'سؤال', answer: 'ج'.repeat(201) }],
    ['a prompt title over 18 characters', { ...emptyShortcutDraft('prompt'), title: 'ع'.repeat(19), content: 'محتوى' }],
    ['a prompt content over 150 characters', { ...emptyShortcutDraft('prompt'), title: 'عنوان', content: 'م'.repeat(151) }],
  ])('refuses %s', (_label, draft) => {
    expect(buildShortcut(draft)).toBeNull()
  })

  it('refuses an empty draft', () => {
    expect(buildShortcut(emptyShortcutDraft('question'))).toBeNull()
    expect(buildShortcut(emptyShortcutDraft('prompt'))).toBeNull()
  })
})

describe('sequence', () => {
  it('appends after the highest stored sequence', () => {
    expect(nextShortcutSequence([])).toBe(0)
    expect(nextShortcutSequence([shortcut({ sequence: 0 }), shortcut({ id: 2, sequence: 4 })])).toBe(5)
  })
})
