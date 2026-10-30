import { describe, expect, it } from 'vitest'
import { InboxReplyCreateSchema, type InboxTemplate } from '@liwan/contracts'
import { buildTemplateReply, dynamicButtons, headerInput, templateReplyReady, type TemplateSendInput } from '../inboxTemplateSend'

const BASE: InboxTemplate = {
  id: 7, name: 'reminder', language: 'ar', category: 'utility', status: 'approved', status_reason: null, quality: 'green', header: null,
  body: 'Hi {{1}}', body_examples: ['Sara'], footer: null, buttons: [], add_security_recommendation: false, code_expiration_minutes: null, param_count: 1, editable: true, otp_button_text: null, supported: true,
}
const INPUT: TemplateSendInput = { params: ['Sara'], headerParam: '', headerAttachmentId: null, headerLocation: null, buttonValues: [] }
const LOCATION = { latitude: 24.7, longitude: 46.6, name: null, address: null }

describe('template send inputs', () => {
  it('asks for a header value only when the header needs one', () => {
    expect(headerInput(BASE)).toBeNull()
    expect(headerInput({ ...BASE, header: { type: 'text', text: 'Fixed', example: null } })).toBeNull()
    expect(headerInput({ ...BASE, header: { type: 'text', text: 'Hi {{1}}', example: 'x' } })).toEqual({ kind: 'text' })
    expect(headerInput({ ...BASE, header: { type: 'video', example_attachment: null } })).toEqual({ kind: 'media', media: 'video' })
    expect(headerInput({ ...BASE, header: { type: 'location' } })).toEqual({ kind: 'location' })
  })

  it('lists the buttons that take a value, by their position among all buttons', () => {
    const template: InboxTemplate = {
      ...BASE,
      buttons: [{ type: 'quick_reply', text: 'Yes' }, { type: 'url', text: 'Static', url: 'https://example.test/a', example: null }, { type: 'url', text: 'Track', url: 'https://example.test/{{1}}', example: 'https://example.test/1' }, { type: 'copy_code', example: 'X' }],
    }
    expect(dynamicButtons(template)).toEqual([{ index: 2, type: 'url', text: 'Track' }, { index: 3, type: 'copy_code', text: null }])
  })
})

describe('template reply', () => {
  const full: InboxTemplate = {
    ...BASE,
    header: { type: 'text', text: 'Hi {{1}}', example: 'x' },
    buttons: [{ type: 'url', text: 'Track', url: 'https://example.test/{{1}}', example: 'https://example.test/1' }, { type: 'copy_code', example: 'X' }],
  }

  it('is just the template and params when nothing else is asked, and matches the contract', () => {
    const reply = buildTemplateReply(BASE, INPUT)
    expect(reply).toEqual({ template_id: 7, params: ['Sara'] })
    expect(InboxReplyCreateSchema.safeParse(reply).success).toBe(true)
  })

  it('carries the header text and each button value with its position', () => {
    const input = { ...INPUT, headerParam: ' Omar ', buttonValues: ['4521', 'SAVE10'] }
    const reply = buildTemplateReply(full, input)
    expect(reply).toEqual({ template_id: 7, params: ['Sara'], header_param: 'Omar', button_params: [{ index: 0, value: '4521' }, { index: 1, value: 'SAVE10' }] })
    expect(InboxReplyCreateSchema.safeParse(reply).success).toBe(true)
  })

  it('carries a header file or location by kind', () => {
    const media = { ...BASE, header: { type: 'image' as const, example_attachment: null } }
    expect(buildTemplateReply(media, { ...INPUT, headerAttachmentId: 41 })).toMatchObject({ header_attachment_id: 41 })
    const place = { ...BASE, header: { type: 'location' as const } }
    expect(buildTemplateReply(place, { ...INPUT, headerLocation: LOCATION })).toMatchObject({ header_location: LOCATION })
  })

  it('sends only the code of an authentication template: the server fills its OTP button', () => {
    const auth: InboxTemplate = { ...BASE, category: 'authentication', otp_button_text: 'Copy' }
    const reply = buildTemplateReply(auth, { ...INPUT, params: ['918273'] })
    expect(reply).toEqual({ template_id: 7, params: ['918273'] })
    expect(templateReplyReady(auth, { ...INPUT, params: ['918273'] })).toBe(true)
  })

  it('is ready only when every asked input is filled', () => {
    expect(templateReplyReady(BASE, INPUT)).toBe(true)
    expect(templateReplyReady(BASE, { ...INPUT, params: [' '] })).toBe(false)
    expect(templateReplyReady(BASE, { ...INPUT, params: [] })).toBe(false)
    expect(templateReplyReady(full, { ...INPUT, headerParam: 'a', buttonValues: ['1', ''] })).toBe(false)
    expect(templateReplyReady(full, { ...INPUT, headerParam: '', buttonValues: ['1', '2'] })).toBe(false)
    expect(templateReplyReady(full, { ...INPUT, headerParam: 'a', buttonValues: ['1', '2'] })).toBe(true)
    const media = { ...BASE, header: { type: 'document' as const, example_attachment: null } }
    expect(templateReplyReady(media, INPUT)).toBe(false)
    expect(templateReplyReady(media, { ...INPUT, headerAttachmentId: 3 })).toBe(true)
    const place = { ...BASE, header: { type: 'location' as const } }
    expect(templateReplyReady(place, INPUT)).toBe(false)
    expect(templateReplyReady(place, { ...INPUT, headerLocation: LOCATION })).toBe(true)
  })
})
