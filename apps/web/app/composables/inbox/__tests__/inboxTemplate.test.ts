import { describe, expect, it } from 'vitest'
import type { InboxTemplate } from '@webvue/contracts'
import {
  addTemplateVariable, buttonProblems, canAddButton, draftFromTemplate, draftPreview, emptyButton, emptyTemplateDraft, finalTemplateName, moveItem,
  quickRepliesGrouped, resizeExamples, slugifyTemplateName, templateDirection, templatePreview, templateWriteCandidate, validateTemplateDraft,
  type TemplateDraft,
} from '../inboxTemplate'

const AUTH_TEXTS = { body: '123456 code.', security: 'Do not share.', expiry: (minutes: number) => `Expires in ${minutes}`, copyCode: 'Copy code' }

const valid = (): TemplateDraft => ({ ...emptyTemplateDraft('Copy'), name: 'order_ready', body: 'Hi {{1}}, order {{2}} is ready.', bodyExamples: ['Sara', '4521'] })

describe('template names and variables', () => {
  it('turns spaces and symbols into single underscores and trims them at the end', () => {
    expect(slugifyTemplateName('Order Ready!')).toBe('order_ready_')
    expect(slugifyTemplateName('a  b--c')).toBe('a_b_c')
    expect(finalTemplateName('  Order Ready! ')).toBe('order_ready')
  })

  it('appends the next variable and keeps what was typed when examples are resized', () => {
    expect(addTemplateVariable('Hi')).toBe('Hi{{1}}')
    expect(addTemplateVariable('Hi {{1}} {{2}}')).toBe('Hi {{1}} {{2}}{{3}}')
    expect(resizeExamples(['a', 'b'], 3)).toEqual(['a', 'b', ''])
    expect(resizeExamples(['a', 'b'], 1)).toEqual(['a'])
  })

  it('draws the preview in the direction of the template language', () => {
    expect(templateDirection('ar')).toBe('rtl')
    expect(templateDirection('en_US')).toBe('ltr')
    expect(templateDirection('ur')).toBe('rtl')
  })
})

describe('template draft validation', () => {
  it('accepts a complete standard draft and sends trimmed values with a null footer', () => {
    const result = validateTemplateDraft({ ...valid(), footer: '  ' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toMatchObject({ name: 'order_ready', category: 'utility', header: null, footer: null, body_examples: ['Sara', '4521'], buttons: [] })
  })

  it('names the body when it has a variable gap or no example', () => {
    const gap = validateTemplateDraft({ ...valid(), body: 'Hi {{2}}', bodyExamples: ['x', 'y'] })
    expect(gap.ok === false && gap.fields.has('body')).toBe(true)
    const missing = validateTemplateDraft({ ...valid(), bodyExamples: ['Sara', ''] })
    expect(missing.ok === false && missing.fields.has('body_examples')).toBe(true)
  })

  it('needs a header example for a header variable and a sample file for a media header', () => {
    const text = { ...valid(), headerKind: 'text' as const, headerText: 'Hello {{1}}' }
    const noExample = validateTemplateDraft(text)
    expect(noExample.ok === false && noExample.fields.has('header')).toBe(true)
    expect(validateTemplateDraft({ ...text, headerExample: 'Sara' }).ok).toBe(true)
    const media = { ...valid(), headerKind: 'image' as const }
    const noSample = validateTemplateDraft(media)
    expect(noSample.ok === false && noSample.fields.has('header')).toBe(true)
    const withSample = validateTemplateDraft({ ...media, headerSample: { id: 9, name: 'a.jpg', mimetype: 'image/jpeg', size: 10 } })
    expect(withSample.ok && withSample.data).toMatchObject({ header: { type: 'image', example_attachment_id: 9 } })
  })

  it('checks buttons: a url variable needs a full example, quick replies must be grouped, a phone must be international', () => {
    const url = { ...emptyButton('url'), text: 'Open', url: 'https://example.test/o/{{1}}' }
    const bad = validateTemplateDraft({ ...valid(), buttons: [url] })
    expect(bad.ok === false && bad.fields.has('buttons')).toBe(true)
    expect(validateTemplateDraft({ ...valid(), buttons: [{ ...url, example: 'https://example.test/o/1' }] }).ok).toBe(true)
    const quick = (text: string) => ({ ...emptyButton('quick_reply'), text })
    const phone = { ...emptyButton('phone_number'), text: 'Call', phone_number: '+966500000000' }
    expect(validateTemplateDraft({ ...valid(), buttons: [quick('a'), phone, quick('b')] }).ok).toBe(false)
    expect(validateTemplateDraft({ ...valid(), buttons: [quick('a'), quick('b'), phone] }).ok).toBe(true)
    expect(validateTemplateDraft({ ...valid(), buttons: [{ ...phone, phone_number: '0500000000' }] }).ok).toBe(false)
  })

  it('validates an authentication draft by its own options only', () => {
    const auth = { ...emptyTemplateDraft('Copy'), name: 'login_code', category: 'authentication' as const, body: '' }
    const ok = validateTemplateDraft({ ...auth, codeExpirationMinutes: '10' })
    expect(ok.ok && ok.data).toMatchObject({ category: 'authentication', code_expiration_minutes: 10, otp_button_text: 'Copy', add_security_recommendation: true })
    const tooLong = validateTemplateDraft({ ...auth, codeExpirationMinutes: '120' })
    expect(tooLong.ok === false && tooLong.fields.has('code_expiration_minutes')).toBe(true)
    const noText = validateTemplateDraft({ ...auth, otpButtonText: ' ' })
    expect(noText.ok === false && noText.fields.has('otp_button_text')).toBe(true)
  })

  it('reports a bad name', () => {
    const result = validateTemplateDraft({ ...valid(), name: '' })
    expect(result.ok === false && result.fields.has('name')).toBe(true)
  })
})

describe('template buttons', () => {
  it('stops adding at Meta limits', () => {
    const two = [emptyButton('url'), emptyButton('url')]
    expect(canAddButton(two, 'url')).toBe(false)
    expect(canAddButton(two, 'quick_reply')).toBe(true)
    expect(canAddButton([emptyButton('phone_number')], 'phone_number')).toBe(false)
    expect(canAddButton([emptyButton('copy_code')], 'copy_code')).toBe(false)
    expect(canAddButton(Array.from({ length: 10 }, () => emptyButton('quick_reply')), 'quick_reply')).toBe(false)
  })

  it('names every broken rule', () => {
    expect(buttonProblems([])).toEqual([])
    const bad = [emptyButton('quick_reply'), emptyButton('url'), emptyButton('quick_reply'), emptyButton('url'), emptyButton('url'), emptyButton('phone_number'), emptyButton('phone_number')]
    expect(buttonProblems(bad)).toEqual(['urls', 'phone', 'grouping'])
    expect(quickRepliesGrouped([emptyButton('url'), emptyButton('quick_reply'), emptyButton('quick_reply')])).toBe(true)
  })

  it('moves a button one place and leaves the ends alone', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
  })
})

const STORED: InboxTemplate = {
  id: 3, name: 'reminder', language: 'ar', category: 'utility', status: 'approved', status_reason: null, quality: 'green',
  header: { type: 'text', text: 'Hello {{1}}', example: 'Sara' }, body: 'Hi {{1}}', body_examples: ['Sara'], footer: 'Clinic',
  buttons: [{ type: 'quick_reply', text: 'Confirm' }, { type: 'url', text: 'Open', url: 'https://example.test/{{1}}', example: 'https://example.test/1' }, { type: 'copy_code', example: 'SAVE10' }],
  add_security_recommendation: false, code_expiration_minutes: null, param_count: 1, editable: true, otp_button_text: null, supported: true,
}

describe('template draft and preview', () => {
  it('rebuilds the same write payload from a stored template', () => {
    const candidate = templateWriteCandidate(draftFromTemplate(STORED)) as Record<string, unknown>
    expect(candidate).toMatchObject({
      name: 'reminder', language: 'ar', category: 'utility', header: { type: 'text', text: 'Hello {{1}}', example: 'Sara' }, body: 'Hi {{1}}', body_examples: ['Sara'], footer: 'Clinic',
      buttons: [{ type: 'quick_reply', text: 'Confirm' }, { type: 'url', text: 'Open', url: 'https://example.test/{{1}}', example: 'https://example.test/1' }, { type: 'copy_code', example: 'SAVE10' }],
    })
    expect(validateTemplateDraft(draftFromTemplate(STORED)).ok).toBe(true)
  })

  it('previews the draft with its examples and the language direction', () => {
    const draft = { ...draftFromTemplate(STORED), body: 'Hi {{1}} and {{2}}', bodyExamples: ['Sara'] }
    const parts = draftPreview(draft, AUTH_TEXTS)
    expect(parts.direction).toBe('rtl')
    expect(parts.header).toEqual({ kind: 'text', text: 'Hello Sara' })
    expect(parts.body).toBe('Hi Sara and {{2}}')
    expect(parts.footer).toBe('Clinic')
    expect(parts.buttons.map(button => button.text)).toEqual(['Confirm', 'Open', 'Copy code'])
  })

  it('previews an authentication draft from Meta\'s fixed text, with the expiry in the footer', () => {
    const auth = { ...emptyTemplateDraft('Copy'), category: 'authentication' as const, codeExpirationMinutes: '15' }
    expect(draftPreview(auth, AUTH_TEXTS)).toMatchObject({ body: '123456 code. Do not share.', footer: 'Expires in 15', buttons: [{ type: 'copy_code', text: 'Copy' }] })
    expect(draftPreview({ ...auth, addSecurityRecommendation: false, codeExpirationMinutes: '' }, AUTH_TEXTS)).toMatchObject({ body: '123456 code.', footer: null })
  })

  it('previews a stored template with the agent\'s values, keeping a placeholder until it is typed', () => {
    const parts = templatePreview(STORED, { params: [''], headerParam: 'Omar', headerMediaName: null }, 'Copy code')
    expect(parts.header).toEqual({ kind: 'text', text: 'Hello Omar' })
    expect(parts.body).toBe('Hi {{1}}')
    expect(parts.buttons.at(-1)).toEqual({ type: 'copy_code', text: 'Copy code' })
    const media = templatePreview({ ...STORED, header: { type: 'image', example_attachment: null } }, { params: ['Sara'], headerParam: '', headerMediaName: 'a.jpg' }, 'x')
    expect(media.header).toEqual({ kind: 'media', media: 'image', name: 'a.jpg' })
    expect(media.body).toBe('Hi Sara')
  })
})

describe('authentication template edit', () => {
  it('prefills the OTP button text from the stored template and previews its button', () => {
    const stored: InboxTemplate = { ...STORED, category: 'authentication', header: null, buttons: [], footer: null, body: '{{1}} is your code.', body_examples: [], add_security_recommendation: true, code_expiration_minutes: 10, otp_button_text: 'Copy it' }
    const draft = draftFromTemplate(stored, 'Default')
    expect(draft).toMatchObject({ category: 'authentication', otpButtonText: 'Copy it', codeExpirationMinutes: '10', addSecurityRecommendation: true })
    expect(templatePreview(stored, { params: ['1'], headerParam: '', headerMediaName: null }, 'Default').buttons).toEqual([{ type: 'copy_code', text: 'Copy it' }])
    expect(draftFromTemplate({ ...stored, otp_button_text: null, supported: true }, 'Default').otpButtonText).toBe('Default')
  })
})
