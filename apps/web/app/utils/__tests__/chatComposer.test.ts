import { describe, expect, it } from 'vitest'
import { composerKeyAction, mentionIdsInText, moveHighlight, shouldNotifyTyping } from '../chatComposer'

const sara = { id: 7, name: 'سارة أحمد' }
const khaled = { id: 8, name: 'Khaled' }
const key = (name: string, extra: Record<string, unknown> = {}) => ({ key: name, shiftKey: false, ...extra })

describe('mentionIdsInText', () => {
  it('keeps only the people whose @name is still in the text', () => {
    expect(mentionIdsInText('hi @Khaled and @سارة أحمد!', [sara, khaled])).toEqual([7, 8])
    expect(mentionIdsInText('hi @Khaled', [sara, khaled])).toEqual([8])
    expect(mentionIdsInText('hi', [sara, khaled])).toEqual([])
  })
  it('drops a mention once its name is edited', () => {
    expect(mentionIdsInText('hi @Khale', [khaled])).toEqual([])
    expect(mentionIdsInText('hi @Khaledx', [khaled])).toEqual([])
    expect(mentionIdsInText('mail a@Khaled', [khaled])).toEqual([])
  })
  it('matches the longest name first so a shorter name inside it is not also mentioned', () => {
    const ali = { id: 1, name: 'Ali' }
    const aliHassan = { id: 2, name: 'Ali Hassan' }
    expect(mentionIdsInText('@Ali Hassan hi', [ali, aliHassan])).toEqual([2])
    expect(mentionIdsInText('@Ali Hassan and @Ali', [ali, aliHassan])).toEqual([1, 2])
    expect(mentionIdsInText('@Ali hi', [ali, aliHassan])).toEqual([1])
  })
  it('handles Arabic names with spaces the same way', () => {
    const short = { id: 1, name: 'سارة' }
    const long = { id: 2, name: 'سارة أحمد' }
    expect(mentionIdsInText('مرحبا @سارة أحمد', [short, long])).toEqual([2])
    expect(mentionIdsInText('مرحبا @سارة، @سارة أحمد', [short, long])).toEqual([1, 2])
  })
  it('resolves a display name shared by two people only through the picked one', () => {
    const first = { id: 1, name: 'Omar' }
    const second = { id: 2, name: 'Omar' }
    expect(mentionIdsInText('hi @Omar', [], [first, second])).toEqual([])
    expect(mentionIdsInText('hi @Omar', [second], [first, second])).toEqual([2])
    expect(mentionIdsInText('hi @Sam', [], [{ id: 3, name: 'Sam' }])).toEqual([3])
  })
  it('lists a person once', () => expect(mentionIdsInText('@Khaled @Khaled', [khaled, khaled])).toEqual([8]))
})

describe('composerKeyAction', () => {
  it('drives the open suggestions with the keys, and Enter picks instead of sending', () => {
    expect(composerKeyAction(key('ArrowDown'), true)).toBe('next')
    expect(composerKeyAction(key('ArrowUp'), true)).toBe('prev')
    expect(composerKeyAction(key('Enter'), true)).toBe('pick')
    expect(composerKeyAction(key('Tab'), true)).toBe('pick')
    expect(composerKeyAction(key('Escape'), true)).toBe('close')
  })
  it('sends on Enter only when the suggestions are closed', () => {
    expect(composerKeyAction(key('Enter'), false)).toBe('send')
    expect(composerKeyAction(key('Enter', { shiftKey: true }), false)).toBeNull()
    expect(composerKeyAction(key('ArrowDown'), false)).toBeNull()
    expect(composerKeyAction(key('Escape'), false)).toBeNull()
  })
  it('ignores Enter while composing text with an IME', () => {
    expect(composerKeyAction(key('Enter', { isComposing: true }), true)).toBeNull()
    expect(composerKeyAction(key('Enter', { isComposing: true }), false)).toBeNull()
  })
})

describe('moveHighlight', () => {
  it('wraps in both directions', () => {
    expect(moveHighlight(2, 1, 3)).toBe(0)
    expect(moveHighlight(0, -1, 3)).toBe(2)
    expect(moveHighlight(0, 1, 0)).toBe(0)
  })
})

describe('shouldNotifyTyping', () => {
  it('sends at most once per 3 seconds', () => {
    expect(shouldNotifyTyping(0, 10_000)).toBe(true)
    expect(shouldNotifyTyping(10_000, 12_999)).toBe(false)
    expect(shouldNotifyTyping(10_000, 13_000)).toBe(true)
  })
})
