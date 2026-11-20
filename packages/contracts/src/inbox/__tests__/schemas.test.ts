import {
  InboxContactDetailSchema,
  InboxChannelPatchSchema,
  InboxChannelSchema,
  InboxChannelWorkListSchema,
  InboxEventListSchema,
  InboxConversationListSchema,
  InboxConversationPatchSchema,
  InboxInteractiveSchema,
  InboxMessageListSchema,
  InboxPresetPreviewSchema,
  InboxReplyCreateSchema,
  InboxAgentAvailabilityPatchSchema,
  InboxAgentListSchema,
  InboxAgentShiftsSchema,
  InboxSettingsPatchSchema,
  InboxChannelAutomationSchema,
  InboxRuleWriteSchema,
  InboxSettingsSchema,
  InboxTemplateSchema,
  InboxWorkingHoursSchema,
  InboxTemplateWriteSchema,
  templatePlaceholderCount,
} from '../index'

const CONVERSATION = {
  id: 1,
  contact: { id: 2, name: 'Sara', phone: '+966500000000', email: null, erased: false },
  channel: { id: 3, name: 'Main WhatsApp', kind: 'whatsapp' },
  department: null,
  assignee: { id: 4, name: 'Agent' },
  state: 'open',
  priority: 'normal',
  tags: [],
  revision: 3,
  last_message_at: '2026-10-28T09:00:00Z',
  last_message_preview: 'Hello',
  last_message_kind: 'text',
  unread: true,
  reply_window_ends_at: '2026-10-29T09:00:00Z',
  waiting_since: null,
  waiting_overdue: false,
  csat: null,
  referral_source: null,
  referral_ref: null,
}

describe('InboxConversationListSchema', () => {
  it('accepts the list envelope and rejects extra keys', () => {
    expect(InboxConversationListSchema.parse({ items: [CONVERSATION], total: 1 }).items[0]).toEqual(CONVERSATION)
    expect(() => InboxConversationListSchema.parse({ items: [{ ...CONVERSATION, secret: 1 }], total: 1 })).toThrow()
  })

  it('requires the erased flag of the contact', () => {
    const { erased: _erased, ...unflagged } = CONVERSATION.contact
    expect(() => InboxConversationListSchema.parse({ items: [{ ...CONVERSATION, contact: unflagged }], total: 1 })).toThrow()
  })

  it('accepts a waiting, overdue conversation', () => {
    const waiting = { ...CONVERSATION, waiting_since: '2026-10-28T08:00:00Z', waiting_overdue: true }
    expect(InboxConversationListSchema.parse({ items: [waiting], total: 1 }).items[0]).toEqual(waiting)
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
    expect(InboxConversationPatchSchema.parse({ revision: 1, assignee_id: null })).toEqual({ revision: 1, assignee_id: null })
    expect(() => InboxConversationPatchSchema.parse({ revision: 1, contact_id: 1 })).toThrow()
  })

  it('names the revision it was made from', () => {
    expect(() => InboxConversationPatchSchema.parse({ priority: 'high' })).toThrow()
    expect(() => InboxConversationPatchSchema.parse({ revision: 0, priority: 'high' })).toThrow()
  })
})

describe('InboxChannelPatchSchema', () => {
  it('only disables a channel: a passing connection test is what connects it', () => {
    expect(InboxChannelPatchSchema.parse({ state: 'disabled' })).toEqual({ state: 'disabled' })
    expect(() => InboxChannelPatchSchema.parse({ state: 'connected' })).toThrow()
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
    expect(keys).not.toContain('has_access_token')
    expect(keys).toContain('connection')
  })
})

describe('InboxEventListSchema', () => {
  const EVENT = { id: 9, state: 'failed', attempts: 5, error: 'item 2: RuntimeError', created_at: '2026-11-11T08:00:00Z' }

  it('accepts a failed delivery and rejects a widened shape', () => {
    expect(InboxEventListSchema.parse({ items: [EVENT], total: 1 }).items[0]).toEqual(EVENT)
    expect(() => InboxEventListSchema.parse({ items: [{ ...EVENT, provider_payload: '{}' }], total: 1 })).toThrow()
    expect(InboxEventListSchema.parse({ items: [{ ...EVENT, error: null }], total: 1 }).items[0].error).toBeNull()
  })
})

describe('InboxChannelWorkListSchema', () => {
  const WORK = { id: 3, name: 'Main WhatsApp', kind: 'whatsapp', department: { id: 7, name: 'Support' } }

  it('accepts the picker shape and rejects any administrator field', () => {
    expect(InboxChannelWorkListSchema.parse({ items: [WORK], total: 1 }).items[0]).toEqual(WORK)
    expect(() => InboxChannelWorkListSchema.parse({
      items: [{ ...WORK, phone_number_id: '100000000001' }], total: 1,
    })).toThrow()
    expect(() => InboxChannelWorkListSchema.parse({
      items: [{ ...WORK, has_access_token: true }], total: 1,
    })).toThrow()
    expect(InboxChannelWorkListSchema.parse({ items: [{ ...WORK, department: null }], total: 1 }).items[0].department).toBeNull()
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

describe('automation schemas', () => {
  const RULE = {
    channel_id: null, name: 'Hours', active: true, match_kind: 'contains', keywords: ['الدوام', 'hours'], option_id: null,
    hours: 'any', stop: true, reply: { body: 'نعمل من 9 إلى 5' }, resolve: false, flow_id: null,
    department_id: null, assignee_id: null, tag_ids: [], priority: null,
  }

  it('accepts a keyword rule and an option rule', () => {
    expect(InboxRuleWriteSchema.parse(RULE)).toEqual(RULE)
    const option = { ...RULE, match_kind: 'option', keywords: [], option_id: 'menu_booking', reply: null, department_id: 3 }
    expect(InboxRuleWriteSchema.parse(option)).toEqual(option)
  })

  it('rejects mismatched match fields and rules without an action', () => {
    expect(() => InboxRuleWriteSchema.parse({ ...RULE, keywords: [] })).toThrow()
    expect(() => InboxRuleWriteSchema.parse({ ...RULE, match_kind: 'option', option_id: 'x' })).toThrow()
    expect(() => InboxRuleWriteSchema.parse({ ...RULE, reply: null })).toThrow()
  })

  it('validates working hours ranges', () => {
    const hours = { timezone: 'Asia/Riyadh', days: [{ weekday: 6, from: '09:00', to: '17:00' }], holidays: [{ name: 'العيد', date_from: '2027-03-20', date_to: '2027-03-23' }] }
    expect(InboxWorkingHoursSchema.parse(hours)).toEqual(hours)
    expect(() => InboxWorkingHoursSchema.parse({ ...hours, days: [{ weekday: 1, from: '17:00', to: '09:00' }] })).toThrow()
  })

  it('needs content for an enabled automatic message', () => {
    const automation = {
      welcome: { enabled: true, idle_days: 0, content: { body: 'أهلًا' } },
      away: { enabled: true, repeat_hours: 12, content: null },
      csat: { enabled: false, question: 'كيف كانت الخدمة؟', good: 'ممتازة', neutral: 'مقبولة', bad: 'سيئة' },
    }
    expect(() => InboxChannelAutomationSchema.parse(automation)).toThrow()
    const fixed = { ...automation, away: { ...automation.away, content: { body: 'نحن خارج الدوام' } } }
    expect(InboxChannelAutomationSchema.parse(fixed)).toEqual(fixed)
  })

  it('carries the assignment policy in settings', () => {
    const settings = { visibility_policy: 'department', auto_close_hours: 72, retention_months: 24, assignment_policy: 'round_robin', first_response_alert_minutes: 15, report_retention_months: 36, agent_shifts_enabled: true, unavailable_release: 'release' }
    expect(InboxSettingsSchema.parse(settings)).toEqual(settings)
    expect(InboxSettingsPatchSchema.parse({ agent_shifts_enabled: false, unavailable_release: 'keep' })).toEqual({ agent_shifts_enabled: false, unavailable_release: 'keep' })
    expect(InboxSettingsPatchSchema.safeParse({ unavailable_release: 'drop' }).success).toBe(false)
  })
})

describe('inbox agent availability', () => {
  const agent = { id: 4, name: 'منى', available: true, in_shift: false, effective_available: false }

  it('lists agents with their manual, shift and effective status', () => {
    expect(InboxAgentListSchema.parse({ items: [agent], total: 1 }).items[0]).toEqual(agent)
    expect(InboxAgentListSchema.safeParse({ items: [{ id: 4, name: 'منى' }], total: 1 }).success).toBe(false)
  })

  it('accepts only the available flag in the availability patch', () => {
    expect(InboxAgentAvailabilityPatchSchema.parse({ available: false })).toEqual({ available: false })
    expect(InboxAgentAvailabilityPatchSchema.safeParse({ available: false, in_shift: true }).success).toBe(false)
  })

  it('validates the ranges of a shift like the working hours do', () => {
    const range = { weekday: 0, from: '08:00', to: '16:00' }
    expect(InboxAgentShiftsSchema.parse({ ranges: [range] })).toEqual({ ranges: [range] })
    expect(InboxAgentShiftsSchema.parse({ ranges: [] })).toEqual({ ranges: [] })
    expect(InboxAgentShiftsSchema.safeParse({ ranges: [{ ...range, to: '07:00' }] }).success).toBe(false)
    expect(InboxAgentShiftsSchema.safeParse({ ranges: [{ ...range, weekday: 7 }] }).success).toBe(false)
  })
})

describe('InboxContactDetailSchema', () => {
  const contact = { id: 5, name: 'Mona', phone: '+966501234567', email: null, erased: false }

  it('is the contact with its linked customer, or null', () => {
    expect(InboxContactDetailSchema.parse({ ...contact, customer: null }).customer).toBeNull()
    expect(InboxContactDetailSchema.parse({ ...contact, customer: { id: 9, name: 'Mona Co' } }).customer).toEqual({ id: 9, name: 'Mona Co' })
    expect(() => InboxContactDetailSchema.parse(contact)).toThrow()
    expect(() => InboxContactDetailSchema.parse({ ...contact, customer: { id: 9, name: 'x', phone: '1' } })).toThrow()
  })
})

describe('InboxPresetPreviewSchema', () => {
  const PREVIEW = {
    key: 'clinic',
    applied: false,
    departments: [{ name: 'الاستقبال', exists: true }],
    tags: [{ name: 'استفسار', exists: false }],
    canned_replies: [{ shortcut: 'hours', body: 'ساعات الدوام: نستقبل رسائلكم في أي وقت.', exists: false }],
    welcome: { body: 'أهلًا', buttons: ['حجز موعد', 'ساعات الدوام', 'التحدث مع موظف'] },
    away: { body: 'نحن خارج الدوام' },
    rules: [{ name: 'قائمة: حجز موعد', button: 'حجز موعد', reply: 'يسعدنا حجز موعد لك', department: 'المواعيد', tags: ['حجز موعد'], exists: false }],
    campaigns: { stop_keywords: ['إيقاف التذكيرات'], start_keywords: ['تفعيل العروض'], stop_reply: 'تم الإيقاف', start_reply: 'تم التفعيل' },
    settings: null,
  }

  it('accepts a preview and a policy change, and rejects an unknown preset, a fourth button or a stray field', () => {
    expect(InboxPresetPreviewSchema.parse(PREVIEW)).toEqual(PREVIEW)
    const policy = { visibility_policy: 'assigned_only', retention_months: 60 }
    expect(InboxPresetPreviewSchema.parse({ ...PREVIEW, settings: policy }).settings).toEqual(policy)
    expect(InboxPresetPreviewSchema.safeParse({ ...PREVIEW, key: 'bank' }).success).toBe(false)
    expect(InboxPresetPreviewSchema.safeParse({ ...PREVIEW, welcome: { ...PREVIEW.welcome, buttons: ['a', 'b', 'c', 'd'] } }).success).toBe(false)
    expect(InboxPresetPreviewSchema.safeParse({ ...PREVIEW, extra: 1 }).success).toBe(false)
  })
})

describe('an erased thread', () => {
  const erased = (id: number, extra: Record<string, unknown> = {}) => ({
    id, direction: 'out', kind: 'text', body: '[erased]', author: null, template: null, delivery_state: 'sent', error: null,
    error_code: null, media_failed: false, unconfirmed: false, attachments: [], reply_to: null,
    reactions: { customer: null, agent: null }, location: null, interactive: null, selected_option: null, flow_response: null,
    automated: false, commerce: null, campaign: null, created_at: '2026-11-20T09:00:00Z', ...extra,
  })

  it('parses interactive, commerce, location and template messages as plain erased text', () => {
    const thread = [
      erased(1), erased(2), erased(3), erased(4), erased(5, { direction: 'in' }),
      erased(6, { kind: 'template', template: { name: 'otp', header_text: null, footer: null, buttons: [] } }),
      erased(7, {
        kind: 'flow_response', direction: 'in',
        flow_response: {
          id: 1, flow: null, conversation_id: 2, contact: { id: 3, name: 'Erased contact 3', erased: true }, request_message_id: null,
          message_id: 7, submitted_at: '2026-11-20T09:00:00Z',
          answers: [{ key: 'day', label: 'Day', kind: 'date', value: null }, { key: 'name', label: 'Name', kind: 'text_input', value: '' }],
        },
      }),
    ]
    expect(InboxMessageListSchema.safeParse({ items: thread, total: thread.length }).success).toBe(true)
  })

  it('still rejects an interactive block with nothing left in it', () => {
    expect(InboxMessageListSchema.safeParse({
      items: [erased(1, { kind: 'interactive', interactive: { type: 'buttons', body: '[erased]', header: null, footer: null, buttons: [] } })],
      total: 1,
    }).success).toBe(false)
  })
})
