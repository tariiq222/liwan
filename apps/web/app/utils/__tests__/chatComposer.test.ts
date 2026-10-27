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
