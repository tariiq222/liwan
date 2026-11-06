import { describe, expect, it } from 'vitest'
import { buildInteractive, emptyInteractiveDraft, interactiveLimits, interactiveTypes } from '../inboxInteractive'

const card = (overrides: Partial<ReturnType<typeof emptyInteractiveDraft>> = {}) => ({
  ...emptyInteractiveDraft(), type: 'buttons' as const, body: 'هل تؤكد الحجز؟', buttons: ['نعم', 'لا'], ...overrides,
})

describe('TikTok button cards', () => {
  it('offers one kind of interactive message and TikTok limits', () => {
    expect(interactiveTypes('tiktok')).toEqual(['buttons'])
    expect(interactiveTypes('whatsapp')).toEqual(['buttons', 'list', 'cta_url', 'flow'])
    expect(interactiveLimits('tiktok')).toMatchObject({ body: 40, buttons: 3, buttonTitle: 20 })
    expect(interactiveLimits('whatsapp')).toMatchObject({ body: 1024, buttons: 3, buttonTitle: 20 })
  })

  it('builds a card of a title and one to three buttons', () => {
    expect(buildInteractive(card(), 'tiktok')).toEqual({
      type: 'buttons', body: 'هل تؤكد الحجز؟', header: null, footer: null,
      buttons: [{ id: 'btn_1', title: 'نعم' }, { id: 'btn_2', title: 'لا' }],
    })
  })

  it.each([
    ['a title over 40 characters', card({ body: 'ع'.repeat(41) })],
    ['a button title over 20 characters', card({ buttons: ['ب'.repeat(21)] })],
    ['four buttons', card({ buttons: ['1', '2', '3', '4'] })],
    ['no button', card({ buttons: [] })],
    ['a header, which TikTok has no room for', card({ header: 'تأكيد' })],
    ['a footer, which TikTok has no room for', card({ footer: 'عيادة' })],
  ])('refuses %s', (_label, draft) => {
    expect(buildInteractive(draft, 'tiktok')).toBeNull()
  })

  it('refuses a list or a link on TikTok', () => {
    expect(buildInteractive({ ...emptyInteractiveDraft(), type: 'list', body: 'الفروع', listButton: 'الفروع', sections: [{ title: '', rows: [{ title: 'الملقا', description: '' }] }] }, 'tiktok')).toBeNull()
    expect(buildInteractive({ ...emptyInteractiveDraft(), type: 'cta_url', body: 'افتح', displayText: 'افتح', url: 'https://example.test' }, 'tiktok')).toBeNull()
  })
})
