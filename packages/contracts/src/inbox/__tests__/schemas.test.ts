import {
  InboxChannelSchema,
  InboxConversationListSchema,
  InboxConversationPatchSchema,
  InboxInteractiveSchema,
  InboxReplyCreateSchema,
  InboxSettingsPatchSchema,
  InboxTemplateSchema,
  InboxTemplateWriteSchema,
  templatePlaceholderCount,
} from '../index'

const CONVERSATION = {
  id: 1,
  contact: { id: 2, name: 'Sara', phone: '+966500000000', email: null },
  channel: { id: 3, name: 'Main WhatsApp', kind: 'whatsapp' },
  department: null,
  assignee: { id: 4, name: 'Agent' },
  state: 'open',
  priority: 'normal',
  tags: [],
  last_message_at: '2026-10-28T09:00:00Z',
  last_message_preview: 'Hello',
  unread: true,
  reply_window_ends_at: '2026-10-29T09:00:00Z',
}

describe('InboxConversationListSchema', () => {
  it('accepts the list envelope and rejects extra keys', () => {
    expect(InboxConversationListSchema.parse({ items: [CONVERSATION], total: 1 }).items[0]).toEqual(CONVERSATION)
    expect(() => InboxConversationListSchema.parse({ items: [{ ...CONVERSATION, secret: 1 }], total: 1 })).toThrow()
  })

  it('requires UTC timestamps', () => {
    expect(() => InboxConversationListSchema.parse({ items: [{ ...CONVERSATION, last_message_at: '2026-10-28 09:00' }], total: 1 })).toThrow()
  })
})

describe('InboxReplyCreateSchema', () => {
  it('takes either free text or a template with params, never both', () => {
    expect(InboxReplyCreateSchema.parse({ body: 'hi' })).toEqual({ body: 'hi' })
    expect(InboxReplyCreateSchema.parse({ template_id: 5, params: ['Sara'] })).toEqual({ template_id: 5, params: ['Sara'] })
    expect(() => InboxReplyCreateSchema.parse({ body: 'hi', template_id: 5, params: [] })).toThrow()
    expect(() => InboxReplyCreateSchema.parse({ body: '' })).toThrow()
  })
})

describe('InboxConversationPatchSchema', () => {
  it('allows clearing the assignee and rejects unknown fields', () => {
    expect(InboxConversationPatchSchema.parse({ assignee_id: null })).toEqual({ assignee_id: null })
    expect(() => InboxConversationPatchSchema.parse({ contact_id: 1 })).toThrow()
  })
})

describe('InboxSettingsPatchSchema', () => {
  it('bounds the numeric policies', () => {
    expect(InboxSettingsPatchSchema.parse({ retention_months: 24 })).toEqual({ retention_months: 24 })
    expect(() => InboxSettingsPatchSchema.parse({ retention_months: 0 })).toThrow()
    expect(() => InboxSettingsPatchSchema.parse({ visibility_policy: 'everyone' })).toThrow()
  })
})

describe('InboxChannelSchema', () => {
  it('never carries a secret value', () => {
    const keys = Object.keys(InboxChannelSchema.shape)
    expect(keys).not.toContain('access_token')
    expect(keys).not.toContain('app_secret')
    expect(keys).toContain('has_access_token')
  })
})

describe('InboxInteractiveSchema', () => {
  const base = { body: 'اختر', header: null, footer: null }
  it('accepts up to three reply buttons and rejects a fourth or a long title', () => {
    const buttons = [1, 2, 3].map(id => ({ id: `b${id}`, title: `زر ${id}` }))
    expect(InboxInteractiveSchema.parse({ type: 'buttons', ...base, buttons }).type).toBe('buttons')
    expect(() => InboxInteractiveSchema.parse({ type: 'buttons', ...base, buttons: [...buttons, { id: 'b4', title: 'x' }] })).toThrow()
    expect(() => InboxInteractiveSchema.parse({ type: 'buttons', ...base, buttons: [{ id: 'b', title: 'x'.repeat(21) }] })).toThrow()
  })

  it('caps a list at ten rows across its sections', () => {
    const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, title: `خيار ${i}`, description: null }))
    expect(InboxInteractiveSchema.parse({ type: 'list', ...base, button: 'القائمة', sections: [{ title: 'أ', rows: rows(6) }, { title: 'ب', rows: rows(4) }] }).type).toBe('list')
    expect(() => InboxInteractiveSchema.parse({ type: 'list', ...base, button: 'القائمة', sections: [{ title: 'أ', rows: rows(6) }, { title: 'ب', rows: rows(5) }] })).toThrow()
  })

  it('takes only an https call-to-action URL', () => {
    expect(InboxInteractiveSchema.parse({ type: 'cta_url', ...base, display_text: 'افتح', url: 'https://example.com/a' }).type).toBe('cta_url')
    expect(() => InboxInteractiveSchema.parse({ type: 'cta_url', ...base, display_text: 'افتح', url: 'http://example.com' })).toThrow()
  })
})

describe('InboxReplyCreateSchema free-form kinds', () => {
  it('accepts a file, a location and an interactive reply, each with an optional reply_to_id', () => {
    expect(InboxReplyCreateSchema.parse({ attachment_id: 3, caption: 'تقرير', reply_to_id: 9 })).toEqual({ attachment_id: 3, caption: 'تقرير', reply_to_id: 9 })
    expect(InboxReplyCreateSchema.parse({ location: { latitude: 24.7, longitude: 46.7, name: null, address: null } })).toBeTruthy()
    expect(() => InboxReplyCreateSchema.parse({ attachment_id: 3, template_id: 1, params: [] })).toThrow()
    expect(() => InboxReplyCreateSchema.parse({ location: { latitude: 91, longitude: 0, name: null, address: null } })).toThrow()
  })
})

const STANDARD = {
  name: 'appointment_reminder',
  language: 'ar',
  category: 'utility',
  allow_category_change: false,
  header: { type: 'text', text: 'موعدك {{1}}', example: 'غدًا' },
  body: 'مرحبًا {{1}}، موعدك يوم {{2}}.',
  body_examples: ['سارة', 'الأحد'],
  footer: 'عيادة النخبة',
  buttons: [
    { type: 'quick_reply', text: 'تأكيد' },
    { type: 'quick_reply', text: 'إلغاء' },
    { type: 'url', text: 'التفاصيل', url: 'https://example.com/b/{{1}}', example: 'https://example.com/b/42' },
  ],
}

describe('InboxTemplateWriteSchema', () => {
  it('accepts a full utility template and an authentication template', () => {
    expect(InboxTemplateWriteSchema.parse(STANDARD)).toEqual(STANDARD)
    const otp = { name: 'login_code', language: 'en', category: 'authentication', add_security_recommendation: true, code_expiration_minutes: 10, otp_button_text: 'Copy code' }
    expect(InboxTemplateWriteSchema.parse(otp)).toEqual(otp)
  })

  it('needs one example per body variable and consecutive variables', () => {
    expect(() => InboxTemplateWriteSchema.parse({ ...STANDARD, body_examples: ['سارة'] })).toThrow()
    expect(() => InboxTemplateWriteSchema.parse({ ...STANDARD, body: 'مرحبًا {{1}} {{3}}' })).toThrow()
  })

  it('applies Meta button limits and grouping', () => {
    const url = { type: 'url', text: 'x', url: 'https://example.com', example: null }
    expect(() => InboxTemplateWriteSchema.parse({ ...STANDARD, buttons: [url, url, url] })).toThrow()
    expect(() => InboxTemplateWriteSchema.parse({ ...STANDARD, buttons: [{ type: 'quick_reply', text: 'a' }, url, { type: 'quick_reply', text: 'b' }] })).toThrow()
    expect(() => InboxTemplateWriteSchema.parse({ ...STANDARD, buttons: [{ ...url, url: 'https://example.com/{{1}}' }] })).toThrow()
    expect(() => InboxTemplateWriteSchema.parse({ ...STANDARD, buttons: [{ ...url, url: 'http://example.com' }] })).toThrow()
  })

  it('rejects a header variable without an example and bad names', () => {
    expect(() => InboxTemplateWriteSchema.parse({ ...STANDARD, header: { type: 'text', text: 'x {{1}}', example: null } })).toThrow()
    expect(() => InboxTemplateWriteSchema.parse({ ...STANDARD, name: 'Bad Name' })).toThrow()
  })

  it('counts placeholders', () => {
    expect(templatePlaceholderCount('a {{2}} b {{1}}')).toBe(2)
    expect(templatePlaceholderCount('none')).toBe(0)
  })
})

describe('InboxTemplateSchema', () => {
  it('parses a synced template with a media header', () => {
    const template = {
      id: 1, name: 'offer', language: 'ar', category: 'marketing', status: 'rejected', status_reason: 'INVALID_FORMAT',
      quality: 'unknown', header: { type: 'image', example_attachment: null }, body: 'خصم {{1}}', body_examples: ['20%'],
      footer: null, buttons: [{ type: 'copy_code', example: 'SALE20' }], add_security_recommendation: false,
      code_expiration_minutes: null, otp_button_text: null, param_count: 1, editable: true, supported: true,
    }
    expect(InboxTemplateSchema.parse(template)).toEqual(template)
  })

  it('reads a WhatsApp Manager template whose values break the write rules', () => {
    const buttons = [{ type: 'url', text: 'Site', url: 'http://example.com/{{1}}', example: null }, { type: 'copy_code', example: '' }]
    const template = {
      id: 2, name: 'legacy', language: 'en', category: 'utility', status: 'approved', status_reason: null, quality: 'green',
      header: null, body: 'Hi', body_examples: [], footer: null, buttons, add_security_recommendation: false,
      code_expiration_minutes: null, otp_button_text: null, param_count: 0, editable: true, supported: true,
    }
    expect(InboxTemplateSchema.parse(template)).toEqual(template)
  })
})

describe('InboxReplyCreateSchema template member', () => {
  it('carries header and button parameters', () => {
    const reply = { template_id: 3, params: ['سارة'], header_attachment_id: 9, button_params: [{ index: 2, value: '42' }] }
    expect(InboxReplyCreateSchema.parse(reply)).toEqual(reply)
    expect(() => InboxReplyCreateSchema.parse({ ...reply, reply_to_id: 4 })).toThrow()
  })
})
