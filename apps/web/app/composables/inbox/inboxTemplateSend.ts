import { templatePlaceholderCount, type InboxLocation, type InboxReplyCreate, type InboxTemplate } from '@liwan/contracts'

// What an agent fills in to send an approved template: the header value (text, a file of the conversation or a
// location), the body variables and the parameter of each button that takes one. The server validates every count
// against the stored template; this file only asks for the right inputs and builds the request.

export type TemplateReply = Extract<InboxReplyCreate, { template_id: number }>
export type HeaderInput = { kind: 'text' } | { kind: 'media'; media: 'image' | 'video' | 'document' } | { kind: 'location' } | null

/** What the template's header needs from the agent. A text header without a variable needs nothing. */
export function headerInput(template: InboxTemplate): HeaderInput {
  const header = template.header
  if (!header) return null
  if (header.type === 'text') return templatePlaceholderCount(header.text) === 1 ? { kind: 'text' } : null
  if (header.type === 'location') return { kind: 'location' }
  return { kind: 'media', media: header.type }
}

export interface DynamicButton {
  /** The button's position among all buttons, which is how the server addresses it. */
  index: number
  type: 'url' | 'copy_code'
  text: string | null
}

/** The buttons that take a value per message: a url ending in a variable, and a copy-code button. An authentication template has none (its OTP button is filled by the server). */
export function dynamicButtons(template: InboxTemplate): DynamicButton[] {
  return template.buttons.flatMap((button, index): DynamicButton[] => {
    if (button.type === 'copy_code') return [{ index, type: 'copy_code', text: null }]
    if (button.type === 'url' && button.url.endsWith('{{1}}')) return [{ index, type: 'url', text: button.text }]
    return []
  })
}

/** The accept list of the header file picker. */
export const HEADER_MEDIA_ACCEPT = { image: 'image/jpeg,image/png', video: 'video/mp4,video/3gpp', document: '.pdf,application/pdf' } as const

export interface TemplateSendInput {
  params: readonly string[]
  headerParam: string
  headerAttachmentId: number | null
  headerLocation: InboxLocation | null
  buttonValues: readonly string[]
}

/**
 * The template reply for the stored template. An authentication template takes its one code as the body variable
 * only; the server fills its OTP button.
 */
export function buildTemplateReply(template: InboxTemplate, input: TemplateSendInput): TemplateReply {
  const header = headerInput(template)
  const params = input.params.slice(0, template.param_count).map(value => value.trim())
  const buttons = dynamicButtons(template)
  const buttonParams = buttons.map((button, position) => ({ index: button.index, value: input.buttonValues[position]?.trim() ?? '' }))
  return {
    template_id: template.id,
    params,
    ...(header?.kind === 'text' ? { header_param: input.headerParam.trim() } : {}),
    ...(header?.kind === 'media' && input.headerAttachmentId ? { header_attachment_id: input.headerAttachmentId } : {}),
    ...(header?.kind === 'location' && input.headerLocation ? { header_location: input.headerLocation } : {}),
    ...(buttonParams.length ? { button_params: buttonParams } : {}),
  }
}

/** Whether every input the template asks for is filled. */
export function templateReplyReady(template: InboxTemplate, input: TemplateSendInput): boolean {
  const header = headerInput(template)
  if (input.params.slice(0, template.param_count).some(value => !value.trim()) || input.params.length < template.param_count) return false
  if (header?.kind === 'text' && !input.headerParam.trim()) return false
  if (header?.kind === 'media' && !input.headerAttachmentId) return false
  if (header?.kind === 'location' && !input.headerLocation) return false
  return dynamicButtons(template).every((_, position) => !!input.buttonValues[position]?.trim())
}
