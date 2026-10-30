import {
  templatePlaceholderCount,
  type InboxCampaign,
  type InboxCampaignParam,
  type InboxCampaignParamLocation,
  type InboxCampaignParamSource,
  type InboxCampaignPreview,
  type InboxTemplate,
} from '@liwan/contracts'
import { templateDirection, type ButtonKind, type TemplatePreviewParts } from './inboxTemplate'
import { dynamicButtons } from './inboxTemplateSend'

// Pure logic of the campaign form: which placeholders a template asks for, the row the admin fills for each, the
// request the server takes, and the preview the server renders. The server checks the set of params against the
// template again; this file only asks for the right inputs.

export const PARAM_SOURCES: readonly InboxCampaignParamSource[] = ['static', 'contact_name', 'contact_first_name', 'contact_phone', 'contact_email']

export interface ParamSlot { location: InboxCampaignParamLocation; position: number; text: string | null }
export interface ParamRow extends ParamSlot { source: InboxCampaignParamSource; value: string }

export const paramKey = (slot: Pick<ParamSlot, 'location' | 'position'>) => `${slot.location}:${slot.position}`

/** The placeholders of a template: the header's {{1}}, body {{1}}..{{n}}, and each button that takes a value. */
export function paramSlots(template: InboxTemplate): ParamSlot[] {
  const header = template.header?.type === 'text' && templatePlaceholderCount(template.header.text) === 1
    ? [{ location: 'header' as const, position: 1, text: null }]
    : []
  const body = Array.from({ length: template.param_count }, (_, index) => ({ location: 'body' as const, position: index + 1, text: null }))
  const buttons = dynamicButtons(template).map(button => ({ location: 'button' as const, position: button.index, text: button.text }))
  return [...header, ...body, ...buttons]
}

/** One row per placeholder of the template, keeping what was already chosen for a placeholder that still exists. */
export function paramRows(template: InboxTemplate | null, existing: readonly Pick<ParamRow, 'location' | 'position' | 'source' | 'value'>[] = []): ParamRow[] {
  if (!template) return []
  const known = new Map(existing.map(row => [paramKey(row), row]))
  return paramSlots(template).map((slot) => {
    const previous = known.get(paramKey(slot))
    return { ...slot, source: previous?.source ?? 'static', value: previous?.value ?? '' }
  })
}

export const rowsFromCampaign = (template: InboxTemplate | null, params: readonly InboxCampaignParam[]) =>
  paramRows(template, params.map(param => ({ location: param.location, position: param.position, source: param.source, value: param.value ?? '' })))

/** The wire params: the static text, or the fallback of a contact field (null when none was typed). */
export function paramsWrite(rows: readonly ParamRow[]): InboxCampaignParam[] {
  return rows.map(row => ({ location: row.location, position: row.position, source: row.source, value: row.value.trim() || null }))
}

/** A static placeholder needs its text; a contact field may go without a fallback. */
export const paramsComplete = (rows: readonly ParamRow[]) => rows.every(row => row.source !== 'static' || row.value.trim() !== '')

/** The media kind of a template whose header is a file the campaign must attach, else null. */
export function headerMediaKind(template: InboxTemplate | null): 'image' | 'video' | 'document' | null {
  const type = template?.header?.type
  return type === 'image' || type === 'video' || type === 'document' ? type : null
}

/** Marketing and utility templates LiwanOS can fill, without a location header (a campaign refuses it). */
export const campaignTemplates = (templates: readonly InboxTemplate[]) =>
  templates.filter(template => template.status === 'approved' && template.supported && template.category !== 'authentication' && template.header?.type !== 'location')

// ---------------------------------------------------------------- schedule

const pad = (value: number) => String(value).padStart(2, '0')

/** A UTC instant as the value of a `datetime-local` input in the browser's own time zone. */
export function utcToLocalInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The local time the admin typed, as the UTC instant the server stores; null while empty or invalid. */
export function localInputToUtc(value: string): string | null {
  const time = value ? new Date(value).getTime() : Number.NaN
  return Number.isNaN(time) ? null : new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ---------------------------------------------------------------- preview

const BUTTON_KINDS: readonly ButtonKind[] = ['quick_reply', 'url', 'phone_number', 'copy_code']
const buttonKind = (type: string): ButtonKind => BUTTON_KINDS.find(kind => kind === type) ?? 'quick_reply'

/** The WhatsApp-like preview of what the server rendered for the sample contact. */
export function campaignPreviewParts(template: InboxTemplate, preview: InboxCampaignPreview, headerName: string | null): TemplatePreviewParts {
  const header = template.header
  return {
    direction: templateDirection(template.language),
    header: !header ? null
      : header.type === 'text' ? { kind: 'text', text: preview.header_text ?? header.text }
        : header.type === 'location' ? { kind: 'location' }
          : { kind: 'media', media: header.type, name: headerName },
    body: preview.body,
    footer: preview.footer,
    buttons: preview.buttons.map(button => ({ type: buttonKind(button.type), text: button.text })),
  }
}

/** The form's fields as the server's write body. */
export interface CampaignDraft {
  name: string
  channelId: number | null
  templateId: number | null
  audienceId: number | null
  rows: ParamRow[]
  headerAttachmentId: number | null
  scheduleMode: 'now' | 'at'
  scheduledLocal: string
  sendWithinHours: boolean
  dailyCap: number
}

export const emptyCampaignDraft = (dailyCap = 0): CampaignDraft => ({
  name: '', channelId: null, templateId: null, audienceId: null, rows: [], headerAttachmentId: null,
  scheduleMode: 'now', scheduledLocal: '', sendWithinHours: false, dailyCap,
})

export const campaignToDraft = (campaign: InboxCampaign, template: InboxTemplate | null): CampaignDraft => ({
  name: campaign.name,
  channelId: campaign.channel.id,
  templateId: campaign.template?.id ?? null,
  audienceId: campaign.audience.id,
  rows: rowsFromCampaign(template, campaign.params),
  headerAttachmentId: campaign.header_attachment?.id ?? null,
  scheduleMode: campaign.scheduled_at ? 'at' : 'now',
  scheduledLocal: utcToLocalInput(campaign.scheduled_at),
  sendWithinHours: campaign.send_within_hours,
  dailyCap: campaign.daily_cap,
})

/** The write body, or null while a required choice is missing. */
export function campaignWrite(draft: CampaignDraft) {
  if (!draft.name.trim() || !draft.channelId || !draft.templateId || !draft.audienceId || !paramsComplete(draft.rows)) return null
  const scheduledAt = draft.scheduleMode === 'at' ? localInputToUtc(draft.scheduledLocal) : null
  if (draft.scheduleMode === 'at' && !scheduledAt) return null
  return {
    name: draft.name.trim(),
    channel_id: draft.channelId,
    template_id: draft.templateId,
    audience_id: draft.audienceId,
    params: paramsWrite(draft.rows),
    header_attachment_id: draft.headerAttachmentId,
    scheduled_at: scheduledAt,
    send_within_hours: draft.sendWithinHours,
    daily_cap: Math.max(0, Math.round(draft.dailyCap || 0)),
  }
}

/** Compared to know whether the form holds unsaved changes. */
export const campaignDraftSignature = (draft: CampaignDraft) => JSON.stringify({ ...draft, rows: draft.rows.map(row => [row.location, row.position, row.source, row.value]) })
