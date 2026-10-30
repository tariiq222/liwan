import { describe, expect, it } from 'vitest'
import type { InboxCampaign, InboxCampaignPreview, InboxTemplate } from '@liwan/contracts'
import {
  campaignDraftSignature, campaignPreviewParts, campaignTemplates, campaignToDraft, campaignWrite, emptyCampaignDraft, headerMediaKind,
  localInputToUtc, paramRows, paramsComplete, paramsWrite, rowsFromCampaign, utcToLocalInput,
} from '../inboxCampaignParams'

const template = (rest: Partial<InboxTemplate> = {}): InboxTemplate => ({
  id: 1, name: 'appointment_reminder', language: 'ar', category: 'utility', status: 'approved', status_reason: null, quality: 'green',
  header: null, body: 'مرحبًا {{1}}، موعدك {{2}}.', body_examples: ['فهد', 'الخميس'], footer: 'عيادة', buttons: [], add_security_recommendation: false,
  code_expiration_minutes: null, otp_button_text: null, param_count: 2, editable: true, supported: true, ...rest,
})
const withButtons = template({
  header: { type: 'text', text: 'أهلًا {{1}}', example: 'س' },
  buttons: [{ type: 'quick_reply', text: 'تأكيد' }, { type: 'url', text: 'إدارة', url: 'https://x.test/{{1}}', example: 'https://x.test/1' }, { type: 'copy_code', example: 'CODE' }],
})

describe('campaign placeholders', () => {
  it('asks for the header variable, each body variable and each button that takes a value, in that order', () => {
    expect(paramRows(withButtons).map(row => `${row.location}:${row.position}`)).toEqual(['header:1', 'body:1', 'body:2', 'button:1', 'button:2'])
  })

  it('asks for nothing from a template without variables', () => {
    expect(paramRows(template({ param_count: 0, body: 'مرحبًا' }))).toEqual([])
    expect(paramRows(null)).toEqual([])
  })

  it('keeps what was chosen for a placeholder that still exists when the template changes', () => {
    const rows = paramRows(template())
    rows[0]!.source = 'contact_first_name'
    rows[0]!.value = 'عميلنا'
    const next = paramRows(template({ param_count: 3, body: '{{1}} {{2}} {{3}}' }), rows)
    expect(next.map(row => [row.position, row.source, row.value])).toEqual([[1, 'contact_first_name', 'عميلنا'], [2, 'static', ''], [3, 'static', '']])
  })

  it('writes a fallback or static text as the value and an empty one as null', () => {
    const rows = paramRows(template())
    rows[0]!.source = 'contact_name'
    rows[1]!.value = ' الخميس '
    expect(paramsWrite(rows)).toEqual([
      { location: 'body', position: 1, source: 'contact_name', value: null },
      { location: 'body', position: 2, source: 'static', value: 'الخميس' },
    ])
  })

  it('is complete only when every static placeholder has its text', () => {
    const rows = paramRows(template())
    expect(paramsComplete(rows)).toBe(false)
    rows.forEach((row) => { row.value = 'x' })
    expect(paramsComplete(rows)).toBe(true)
    rows[0]!.source = 'contact_phone'
    rows[0]!.value = ''
    expect(paramsComplete(rows)).toBe(true)
  })
})

describe('campaign templates', () => {
  it('offers approved marketing and utility templates LiwanOS can fill, never authentication or a location header', () => {
    const all = [
      template({ id: 1 }),
      template({ id: 2, category: 'marketing' }),
      template({ id: 3, category: 'authentication' }),
      template({ id: 4, status: 'paused' }),
      template({ id: 5, supported: false }),
      template({ id: 6, header: { type: 'location' } }),
      template({ id: 7, header: { type: 'image', example_attachment: null } }),
    ]
    expect(campaignTemplates(all).map(item => item.id)).toEqual([1, 2, 7])
  })

  it('finds the media kind that needs a header file', () => {
    expect(headerMediaKind(template({ header: { type: 'video', example_attachment: null } }))).toBe('video')
    expect(headerMediaKind(template({ header: { type: 'text', text: 'x', example: null } }))).toBeNull()
    expect(headerMediaKind(null)).toBeNull()
  })
})

describe('campaign schedule', () => {
  it('round-trips a UTC instant through the local input', () => {
    const utc = '2026-11-01T09:30:00Z'
    expect(localInputToUtc(utcToLocalInput(utc))).toBe(utc)
    expect(utcToLocalInput(null)).toBe('')
    expect(localInputToUtc('')).toBeNull()
    expect(localInputToUtc('nope')).toBeNull()
  })
})

describe('campaign draft', () => {
  const full = () => {
    const draft = emptyCampaignDraft(50)
    Object.assign(draft, { name: ' عروض ', channelId: 1, templateId: 1, audienceId: 2 })
    draft.rows = paramRows(template()).map((row) => { row.value = 'x'; return row })
    return draft
  }

  it('starts from the default daily cap', () => {
    expect(emptyCampaignDraft(50).dailyCap).toBe(50)
  })

  it('builds the write body when everything is chosen', () => {
    expect(campaignWrite(full())).toEqual({
      name: 'عروض', channel_id: 1, template_id: 1, audience_id: 2, header_attachment_id: null, scheduled_at: null, send_within_hours: false, daily_cap: 50,
      params: [{ location: 'body', position: 1, source: 'static', value: 'x' }, { location: 'body', position: 2, source: 'static', value: 'x' }],
    })
  })

  it.each([
    ['name', (d: ReturnType<typeof full>) => { d.name = ' ' }],
    ['channel', (d: ReturnType<typeof full>) => { d.channelId = null }],
    ['template', (d: ReturnType<typeof full>) => { d.templateId = null }],
    ['audience', (d: ReturnType<typeof full>) => { d.audienceId = null }],
    ['a static text', (d: ReturnType<typeof full>) => { d.rows[0]!.value = '' }],
    ['a start time', (d: ReturnType<typeof full>) => { d.scheduleMode = 'at' }],
  ])('sends nothing while %s is missing', (_, spoil) => {
    const draft = full()
    spoil(draft)
    expect(campaignWrite(draft)).toBeNull()
  })

  it('sends the chosen start time as UTC', () => {
    const draft = full()
    draft.scheduleMode = 'at'
    draft.scheduledLocal = utcToLocalInput('2026-12-01T10:00:00Z')
    expect(campaignWrite(draft)?.scheduled_at).toBe('2026-12-01T10:00:00Z')
  })

  it('reads a stored campaign back into the same draft and signature', () => {
    const stored = {
      name: 'عروض', channel: { id: 1, name: 'ق' }, template: { id: 1 }, audience: { id: 2, name: 'ج' }, header_attachment: null, scheduled_at: null, send_within_hours: true, daily_cap: 10,
      params: [{ location: 'body', position: 1, source: 'contact_name', value: null }, { location: 'body', position: 2, source: 'static', value: 'الخميس' }],
    } as unknown as InboxCampaign
    const draft = campaignToDraft(stored, template())
    expect(draft).toMatchObject({ name: 'عروض', channelId: 1, templateId: 1, audienceId: 2, sendWithinHours: true, dailyCap: 10 })
    expect(rowsFromCampaign(template(), stored.params).map(row => [row.source, row.value])).toEqual([['contact_name', ''], ['static', 'الخميس']])
    draft.rows = rowsFromCampaign(template(), stored.params)
    expect(campaignDraftSignature(draft)).toBe(campaignDraftSignature({ ...draft, rows: draft.rows.map(row => ({ ...row })) }))
  })
})

describe('campaign preview', () => {
  const rendered: InboxCampaignPreview = {
    contact: { id: 3, name: 'منى' }, header_text: 'أهلًا منى', body: 'مرحبًا منى، موعدك الخميس.', footer: 'عيادة',
    buttons: [{ type: 'url', text: 'إدارة' }, { type: 'weird', text: 'ما' }], missing: [],
  }

  it('shows what the server rendered, in the language direction of the template', () => {
    const parts = campaignPreviewParts(withButtons, rendered, null)
    expect(parts).toMatchObject({ direction: 'rtl', header: { kind: 'text', text: 'أهلًا منى' }, body: rendered.body, footer: 'عيادة' })
    expect(parts.buttons.map(button => button.type)).toEqual(['url', 'quick_reply'])
  })

  it('draws a media header with the uploaded file name', () => {
    const media = template({ header: { type: 'image', example_attachment: null }, language: 'en' })
    expect(campaignPreviewParts(media, rendered, 'offer.jpg')).toMatchObject({ direction: 'ltr', header: { kind: 'media', media: 'image', name: 'offer.jpg' } })
  })
})
