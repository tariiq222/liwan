import type { LocationQuery } from 'vue-router'
import {
  InboxCampaignStateSchema,
  InboxConsentStateSchema,
  InboxRecipientFailureSchema,
  InboxRecipientStateSchema,
  type InboxCampaignState,
  type InboxConsentState,
  type InboxRecipientFailure,
  type InboxRecipientState,
} from '@webvue/contracts'

// The filters of the campaign screens. Each lives in the URL query, so a direct link, a refresh and Back keep them:
// the campaigns list, the recipients table of one campaign, the audience list and an audience's members.

/** Rows per page of every campaign table. */
export const CAMPAIGN_PAGE_SIZE = 20

function single(value: LocationQuery[string] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

function offsetOf(value: LocationQuery[string] | undefined): number {
  const number = Number(single(value))
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function positiveInt(value: string): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

const keep = (query: Record<string, string | number | null | undefined | false>) =>
  Object.fromEntries(Object.entries(query).filter(([, value]) => value !== '' && value !== null && value !== undefined && value !== false)) as Record<string, string | number>

/** The offset of a 1-based page, kept inside the list so a stale link never lands past the end. */
export function campaignPageOffset(page: number, total: number): number {
  const lastPage = Math.max(1, Math.ceil(total / CAMPAIGN_PAGE_SIZE))
  return (Math.min(Math.max(page, 1), lastPage) - 1) * CAMPAIGN_PAGE_SIZE
}

// ---------------------------------------------------------------- campaigns list

export interface CampaignListRoute { state: InboxCampaignState | ''; channelId: number | null; q: string; offset: number }
export const DEFAULT_CAMPAIGN_LIST_ROUTE: CampaignListRoute = { state: '', channelId: null, q: '', offset: 0 }

export function parseCampaignListRoute(query: LocationQuery): CampaignListRoute {
  const state = InboxCampaignStateSchema.safeParse(single(query.state))
  return { state: state.success ? state.data : '', channelId: positiveInt(single(query.channel_id)), q: single(query.q).trim(), offset: offsetOf(query.offset) }
}

export const serializeCampaignListRoute = (route: CampaignListRoute) =>
  keep({ state: route.state, channel_id: route.channelId, q: route.q, offset: route.offset || null }) as Record<string, string>

export const campaignListQuery = (route: CampaignListRoute) =>
  keep({ state: route.state, channel_id: route.channelId, q: route.q, limit: CAMPAIGN_PAGE_SIZE, offset: route.offset })

// ---------------------------------------------------------------- recipients of one campaign

export interface RecipientRoute { state: InboxRecipientState | ''; failure: InboxRecipientFailure | ''; q: string; offset: number }
export const DEFAULT_RECIPIENT_ROUTE: RecipientRoute = { state: '', failure: '', q: '', offset: 0 }

export function parseRecipientRoute(query: LocationQuery): RecipientRoute {
  const state = InboxRecipientStateSchema.safeParse(single(query.state))
  const failure = InboxRecipientFailureSchema.safeParse(single(query.failure))
  return { state: state.success ? state.data : '', failure: failure.success ? failure.data : '', q: single(query.q).trim(), offset: offsetOf(query.offset) }
}

export const serializeRecipientRoute = (route: RecipientRoute) =>
  keep({ state: route.state, failure: route.failure, q: route.q, offset: route.offset || null }) as Record<string, string>

export const recipientQuery = (route: RecipientRoute) =>
  keep({ state: route.state, failure: route.failure, q: route.q, limit: CAMPAIGN_PAGE_SIZE, offset: route.offset })

// ---------------------------------------------------------------- audiences and their members

export interface AudienceListRoute { q: string; offset: number }
export const DEFAULT_AUDIENCE_LIST_ROUTE: AudienceListRoute = { q: '', offset: 0 }

export const parseAudienceListRoute = (query: LocationQuery): AudienceListRoute => ({ q: single(query.q).trim(), offset: offsetOf(query.offset) })
export const serializeAudienceListRoute = (route: AudienceListRoute) => keep({ q: route.q, offset: route.offset || null }) as Record<string, string>
export const audienceListQuery = (route: AudienceListRoute) => keep({ q: route.q, limit: CAMPAIGN_PAGE_SIZE, offset: route.offset })

export interface MemberRoute { consent: InboxConsentState | ''; q: string; offset: number }
export const DEFAULT_MEMBER_ROUTE: MemberRoute = { consent: '', q: '', offset: 0 }

export function parseMemberRoute(query: LocationQuery): MemberRoute {
  const consent = InboxConsentStateSchema.safeParse(single(query.consent))
  return { consent: consent.success ? consent.data : '', q: single(query.q).trim(), offset: offsetOf(query.offset) }
}

export const serializeMemberRoute = (route: MemberRoute) => keep({ consent: route.consent, q: route.q, offset: route.offset || null }) as Record<string, string>
export const memberQuery = (route: MemberRoute) => keep({ consent: route.consent, q: route.q, limit: CAMPAIGN_PAGE_SIZE, offset: route.offset })
