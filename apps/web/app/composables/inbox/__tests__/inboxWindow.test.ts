import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REPLY_WINDOW_HOURS, cannedSuggestions, renderTemplateBody, replyWindowOpen, windowClosedDescriptionKey } from '../inboxWindow'

const NOW = Date.parse('2026-10-28T12:00:00Z')

describe('replyWindowOpen', () => {
  it('is open until the window end', () => {
    expect(replyWindowOpen({ reply_window_ends_at: '2026-10-28T12:00:01Z' }, NOW)).toBe(true)
  })

  it('is closed at and after the window end', () => {
    expect(replyWindowOpen({ reply_window_ends_at: '2026-10-28T12:00:00Z' }, NOW)).toBe(false)
    expect(replyWindowOpen({ reply_window_ends_at: '2026-10-27T11:00:00Z' }, NOW)).toBe(false)
  })

  it('is closed when the customer never wrote', () => {
    expect(replyWindowOpen({ reply_window_ends_at: null }, NOW)).toBe(false)
  })
})

describe('renderTemplateBody', () => {
  it('fills the numbered placeholders and keeps the ones still empty', () => {
    expect(renderTemplateBody('مرحبا {{1}}، موعدك {{2}}', ['سارة', ' '])).toBe('مرحبا سارة، موعدك {{2}}')
  })

  it('repeats a value used twice', () => {
    expect(renderTemplateBody('{{1}} و{{1}}', ['أ'])).toBe('أ وأ')
  })
})

describe('cannedSuggestions', () => {
  const replies = [{ shortcut: 'hello', body: 'a' }, { shortcut: '/hours', body: 'b' }, { shortcut: 'Help', body: 'c' }]

  it('suggests nothing unless the draft is a slash and its prefix', () => {
    expect(cannedSuggestions('hello', replies)).toEqual([])
    expect(cannedSuggestions('/he llo', replies)).toEqual([])
    expect(cannedSuggestions('', replies)).toEqual([])
  })

  it('matches a shortcut prefix without case or the stored slash', () => {
    expect(cannedSuggestions('/h', replies).map(reply => reply.body)).toEqual(['a', 'b', 'c'])
    expect(cannedSuggestions('/HE', replies).map(reply => reply.body)).toEqual(['a', 'c'])
    expect(cannedSuggestions('/hou', replies).map(reply => reply.body)).toEqual(['b'])
  })

  it('lists every reply for a bare slash, capped', () => {
    expect(cannedSuggestions('/', replies, 2)).toHaveLength(2)
  })
})

describe('the reply window of each kind', () => {
  it('is 24 hours on WhatsApp and 48 on TikTok (D4)', () => {
    expect(REPLY_WINDOW_HOURS).toEqual({ whatsapp: 24, tiktok: 48 })
    expect(windowClosedDescriptionKey('whatsapp')).toBe('inbox.composer.windowClosedByKind.whatsapp')
    expect(windowClosedDescriptionKey('tiktok')).toBe('inbox.composer.windowClosedByKind.tiktok')
  })

  it('says 48 hours in both catalogues for a TikTok conversation', () => {
    for (const locale of ['ar', 'en']) {
      const catalogue = JSON.parse(readFileSync(new URL(`../../../../i18n/locales/${locale}/inbox.json`, import.meta.url), 'utf8'))
      expect(catalogue.inbox.composer.windowClosedByKind.tiktok).toContain('48')
      expect(catalogue.inbox.composer.windowClosedByKind.whatsapp).toContain('24')
    }
  })
})
