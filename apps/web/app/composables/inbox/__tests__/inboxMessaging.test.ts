import { describe, expect, it, vi } from 'vitest'
import { INBOX_CAPTION_MAX, INBOX_FILE_MAX_BYTES, INBOX_IMAGE_MAX_BYTES, INBOX_UPLOAD_ACCEPT, inboxAcceptsCaption, inboxFileSize, inboxUploadProblem } from '../inboxAttachments'
import { buildInteractive, emptyInteractiveDraft, interactiveRowCount, normalizeInteractiveDraft } from '../inboxInteractive'
import { buildLocation, emptyLocationDraft, locationMapUrl } from '../inboxLocation'
import { createTypingNotifier } from '../inboxTyping'

describe('inbox upload limits', () => {
  it('caps images at 5 MB and every other file at 10 MiB', () => {
    expect(inboxUploadProblem({ type: 'image/png', size: INBOX_IMAGE_MAX_BYTES })).toBeNull()
    expect(inboxUploadProblem({ type: 'image/png', size: INBOX_IMAGE_MAX_BYTES + 1 })).toEqual({ reason: 'tooLarge', limitMb: 5 })
    expect(inboxUploadProblem({ type: 'video/mp4', size: INBOX_FILE_MAX_BYTES })).toBeNull()
    expect(inboxUploadProblem({ type: 'application/pdf', size: INBOX_FILE_MAX_BYTES + 1 })).toEqual({ reason: 'tooLarge', limitMb: 10 })
  })

  it('refuses empty files and media types WhatsApp does not take, and treats any other type as a document', () => {
    expect(inboxUploadProblem({ type: 'application/pdf', size: 0 })).toEqual({ reason: 'empty' })
    expect(inboxUploadProblem({ type: 'image/gif', size: 10 })).toEqual({ reason: 'unsupported' })
    expect(inboxUploadProblem({ type: 'audio/wav', size: 10 })).toEqual({ reason: 'unsupported' })
    expect(inboxUploadProblem({ type: '', size: 10 })).toBeNull()
    expect(inboxUploadProblem({ type: 'application/vnd.ms-excel', size: 10 })).toBeNull()
  })

  it('offers no type the server rejects and takes no caption on audio', () => {
    expect(INBOX_UPLOAD_ACCEPT).not.toContain('csv')
    expect(inboxAcceptsCaption('audio/ogg')).toBe(false)
    expect(inboxAcceptsCaption('image/png')).toBe(true)
    expect(INBOX_CAPTION_MAX).toBe(1024)
  })

  it('formats sizes', () => {
    expect(inboxFileSize(2048)).toBe('2 KB')
    expect(inboxFileSize(3 * 1048576)).toBe('3.0 MB')
  })
})

describe('inbox interactive builder', () => {
  it('builds reply buttons with positional ids and trims blanks to null', () => {
    const draft = { ...emptyInteractiveDraft(), body: ' هل تؤكد؟ ', header: '  ', buttons: ['نعم', 'لا'] }
    expect(buildInteractive(draft)).toEqual({ type: 'buttons', body: 'هل تؤكد؟', header: null, footer: null, buttons: [{ id: 'btn_1', title: 'نعم' }, { id: 'btn_2', title: 'لا' }] })
  })

  it('refuses a draft that breaks a limit', () => {
    const base = { ...emptyInteractiveDraft(), body: 'x', buttons: ['a'] }
    expect(buildInteractive(base)).not.toBeNull()
    expect(buildInteractive({ ...base, body: '' })).toBeNull()
    expect(buildInteractive({ ...base, buttons: ['a'.repeat(21)] })).toBeNull()
    expect(buildInteractive({ ...base, buttons: ['a', 'b', 'c', 'd'] })).toBeNull()
    expect(buildInteractive({ ...base, buttons: [''] })).toBeNull()
  })

  it('builds a list with row ids running across sections and counts rows', () => {
    const draft = {
      ...emptyInteractiveDraft(), type: 'list' as const, body: 'اختر', listButton: 'الخيارات',
      sections: [
        { title: 'أ', rows: [{ title: 'واحد', description: '' }, { title: 'اثنان', description: 'وصف' }] },
        { title: 'ب', rows: [{ title: 'ثلاثة', description: '' }] },
      ],
    }
    expect(interactiveRowCount(draft)).toBe(3)
    const built = buildInteractive(draft)
    expect(built).toMatchObject({ type: 'list', button: 'الخيارات' })
    expect(built?.type === 'list' && built.sections.map(section => section.rows.map(row => row.id))).toEqual([['row_1', 'row_2'], ['row_3']])
    expect(buildInteractive({ ...draft, sections: [{ title: '', rows: draft.sections[0]!.rows }, draft.sections[1]!] })).toBeNull()
    expect(buildInteractive({ ...draft, sections: [{ title: '', rows: draft.sections[0]!.rows }] })).not.toBeNull()
  })

  it('refuses more than ten rows in total', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({ title: `r${index}`, description: '' }))
    const draft = { ...emptyInteractiveDraft(), type: 'list' as const, body: 'x', listButton: 'y', sections: [{ title: 'a', rows }, { title: 'b', rows }] }
    expect(interactiveRowCount(draft)).toBe(12)
    expect(buildInteractive(draft)).toBeNull()
  })

  it('accepts only an https call-to-action link', () => {
    const draft = { ...emptyInteractiveDraft(), type: 'cta_url' as const, body: 'x', displayText: 'افتح', url: 'https://example.test/a' }
    expect(buildInteractive(draft)).toMatchObject({ type: 'cta_url', display_text: 'افتح', url: 'https://example.test/a' })
    expect(buildInteractive({ ...draft, url: 'http://example.test' })).toBeNull()
  })

  it('reads a stored draft defensively', () => {
    expect(normalizeInteractiveDraft({ type: 'nope' })).toBeNull()
    expect(normalizeInteractiveDraft('x')).toBeNull()
    expect(normalizeInteractiveDraft({ type: 'buttons', buttons: ['a', 5, 'b', 'c', 'd'] })?.buttons).toEqual(['a', 'b', 'c'])
  })
})

describe('inbox location', () => {
  it('parses Latin and Arabic-Indic coordinates and nulls blank names', () => {
    expect(buildLocation({ ...emptyLocationDraft(), latitude: '24.7136', longitude: '46.6753', name: ' الرياض ' })).toEqual({ latitude: 24.7136, longitude: 46.6753, name: 'الرياض', address: null })
    expect(buildLocation({ ...emptyLocationDraft(), latitude: '٢٤٫٥', longitude: '٤٦٫٧' })).toMatchObject({ latitude: 24.5, longitude: 46.7 })
  })

  it('refuses missing or out-of-range coordinates', () => {
    expect(buildLocation(emptyLocationDraft())).toBeNull()
    expect(buildLocation({ ...emptyLocationDraft(), latitude: '91', longitude: '0' })).toBeNull()
    expect(buildLocation({ ...emptyLocationDraft(), latitude: 'abc', longitude: '0' })).toBeNull()
  })

  it('links to OpenStreetMap', () => {
    expect(locationMapUrl({ latitude: 24.7, longitude: 46.6 })).toContain('openstreetmap.org/?mlat=24.7&mlon=46.6')
  })
})

describe('inbox typing indicator', () => {
  it('sends at most once per interval and ignores a failure', async () => {
    let now = 0
    const send = vi.fn(async () => { throw new Error('offline') })
    const notify = createTypingNotifier(send, 3000, () => now)
    notify(); notify()
    now = 2999; notify()
    expect(send).toHaveBeenCalledTimes(1)
    now = 3000; notify()
    expect(send).toHaveBeenCalledTimes(2)
    await Promise.resolve()
  })
})
