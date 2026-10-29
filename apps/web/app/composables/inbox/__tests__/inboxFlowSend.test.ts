import { describe, expect, it } from 'vitest'
import type { InboxTemplate } from '@webvue/contracts'
import { INTERACTIVE_LIMITS, buildInteractive, emptyInteractiveDraft, interactiveToDraft, normalizeInteractiveDraft } from '../inboxInteractive'
import { buildAutoContent, autoContentToDraft } from '../inboxAutomation'
import { buttonProblems, canAddButton, draftFromTemplate, emptyButton, emptyTemplateDraft, templateWriteCandidate, validateTemplateDraft } from '../inboxTemplate'

describe('a form message', () => {
  const draft = { ...emptyInteractiveDraft(), type: 'flow' as const, body: 'املأ النموذج', flowId: 7, flowCta: 'افتح النموذج' }

  it('is built with the form id and the button text, and the header and footer are optional', () => {
    expect(buildInteractive(draft)).toEqual({ type: 'flow', body: 'املأ النموذج', header: null, footer: null, flow_id: 7, cta: 'افتح النموذج' })
    expect(buildInteractive({ ...draft, header: ' عنوان ', footer: 'تذييل' })).toMatchObject({ header: 'عنوان', footer: 'تذييل' })
  })

  it('is not built without a chosen form, a button text, a body, or with a button text over 30', () => {
    expect(buildInteractive({ ...draft, flowId: null })).toBeNull()
    expect(buildInteractive({ ...draft, flowCta: ' ' })).toBeNull()
    expect(buildInteractive({ ...draft, body: '' })).toBeNull()
    expect(buildInteractive({ ...draft, flowCta: 'x'.repeat(INTERACTIVE_LIMITS.flowCta + 1) })).toBeNull()
  })

  it('reads back into a draft, from a stored message and from a stored composer draft', () => {
    const wire = buildInteractive(draft)!
    expect(interactiveToDraft(wire)).toMatchObject({ type: 'flow', flowId: 7, flowCta: 'افتح النموذج', body: 'املأ النموذج' })
    expect(normalizeInteractiveDraft(JSON.parse(JSON.stringify(draft)))).toMatchObject({ type: 'flow', flowId: 7, flowCta: 'افتح النموذج' })
    expect(normalizeInteractiveDraft({ ...draft, flowId: 'x' })).toMatchObject({ flowId: null })
    expect(normalizeInteractiveDraft({ ...draft, flowId: -3 })).toMatchObject({ flowId: null })
  })

  it('is automatic content too (welcome, away and rule replies share the builder)', () => {
    const content = buildAutoContent({ mode: 'interactive', body: '', interactive: draft })
    expect(content).toEqual({ interactive: expect.objectContaining({ type: 'flow', flow_id: 7 }) })
    expect(autoContentToDraft(content)).toMatchObject({ mode: 'interactive', interactive: { type: 'flow', flowId: 7 } })
  })
})

describe('a template form button', () => {
  const base = () => ({ ...emptyTemplateDraft(), name: 'booking', body: 'احجز موعدك' })

  it('is sent with the form id and needs a text and a form', () => {
    const draft = base()
    draft.buttons = [{ ...emptyButton('flow'), text: 'احجز', flowId: 3 }]
    expect(templateWriteCandidate(draft)).toMatchObject({ buttons: [{ type: 'flow', text: 'احجز', flow_id: 3 }] })
    expect(validateTemplateDraft(draft).ok).toBe(true)
    draft.buttons[0]!.flowId = null
    expect(validateTemplateDraft(draft)).toMatchObject({ ok: false })
    draft.buttons[0]!.flowId = 3
    draft.buttons[0]!.text = ''
    expect(validateTemplateDraft(draft)).toMatchObject({ ok: false })
  })

  it('allows one, and counts it among the ten buttons', () => {
    const one = [emptyButton('flow')]
    expect(canAddButton(one, 'flow')).toBe(false)
    expect(canAddButton(one, 'url')).toBe(true)
    expect(buttonProblems([...one, emptyButton('flow')])).toContain('flow')
    expect(buttonProblems(one)).toEqual([])
  })

  it('reads back from a stored template, with its form or without it when WebVue does not know it', () => {
    const template = {
      id: 1, name: 'booking', language: 'ar', category: 'utility', status: 'approved', status_reason: null, quality: 'green', header: null, body: 'احجز', body_examples: [], footer: null,
      add_security_recommendation: false, code_expiration_minutes: null, param_count: 0, editable: true, otp_button_text: null, supported: true,
      buttons: [{ type: 'flow', text: 'احجز', flow: { id: 3, name: 'طلب' }, provider_flow_id: '99' }, { type: 'quick_reply', text: 'لاحقًا' }],
    } as unknown as InboxTemplate
    expect(draftFromTemplate(template).buttons.map(button => [button.type, button.flowId])).toEqual([['flow', 3], ['quick_reply', null]])
    const unknown = { ...template, buttons: [{ type: 'flow', text: 'احجز', flow: null, provider_flow_id: '99' }] } as unknown as InboxTemplate
    expect(draftFromTemplate(unknown).buttons[0]!.flowId).toBeNull()
  })
})
