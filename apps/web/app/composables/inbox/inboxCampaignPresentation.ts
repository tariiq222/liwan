import type {
  InboxCampaign,
  InboxCampaignState,
  InboxCampaignStats,
  InboxConsentState,
  InboxRecipientState,
} from '@webvue/contracts'
import type { KpiTile } from '@webvue/ui/app/utils/kpiTile'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'

// What the campaign screens show for a state: the badge tone, the actions a state allows, the live-refresh rule and the
// figures of the stats strip.

export const CAMPAIGN_STATES: readonly InboxCampaignState[] = ['draft', 'scheduled', 'running', 'paused', 'done', 'cancelled']
export const RECIPIENT_STATES: readonly InboxRecipientState[] = ['pending', 'skipped', 'queued', 'sent', 'delivered', 'read', 'failed']
export const CONSENT_STATES: readonly InboxConsentState[] = ['unknown', 'opted_in', 'opted_out']

export const CAMPAIGN_STATE_TONE: Record<InboxCampaignState, StatusTone> = {
  draft: 'neutral', scheduled: 'info', running: 'primary', paused: 'warning', done: 'success', cancelled: 'neutral',
}
export const RECIPIENT_STATE_TONE: Record<InboxRecipientState, StatusTone> = {
  pending: 'neutral', skipped: 'warning', queued: 'info', sent: 'info', delivered: 'success', read: 'success', failed: 'destructive',
}
export const CONSENT_TONE: Record<InboxConsentState, StatusTone> = { unknown: 'neutral', opted_in: 'success', opted_out: 'destructive' }

/** Stats are refetched this often while a campaign is waiting to start or sending (the page must be visible). */
export const CAMPAIGN_POLL_MS = 10_000
export const campaignPollInterval = (state: InboxCampaignState | undefined): number | false =>
  state === 'scheduled' || state === 'running' ? CAMPAIGN_POLL_MS : false

export type CampaignAction = 'launch' | 'pause' | 'resume' | 'cancel' | 'retry'
/** The actions a campaign offers in its header, by state. Deleting is separate (`can_delete`). */
export function campaignActions(campaign: Pick<InboxCampaign, 'state' | 'stats'>): CampaignAction[] {
  const retry: CampaignAction[] = campaign.stats.failed > 0 ? ['retry'] : []
  switch (campaign.state) {
    case 'draft': return ['launch']
    case 'scheduled': return ['cancel']
    case 'running': return ['pause', 'cancel', ...retry]
    case 'paused': return ['resume', 'cancel', ...retry]
    case 'done': return retry
    default: return []
  }
}
/** Launch and cancel cannot be taken back, so they are confirmed inline first. */
export const CONFIRMED_ACTIONS: readonly CampaignAction[] = ['launch', 'cancel']

/** Share of recipients that reached a final good state, 0..100; null while there are none. */
export function deliveredPercent(stats: InboxCampaignStats): number | null {
  const reachable = stats.total - stats.skipped
  if (reachable <= 0) return null
  return Math.min(100, Math.round(((stats.delivered + stats.read) / reachable) * 100))
}

/** Share of recipients that are no longer waiting to be sent (queued onward), for the progress bar. */
export function dispatchedPercent(stats: InboxCampaignStats): number | null {
  const reachable = stats.total - stats.skipped
  if (reachable <= 0) return null
  return Math.min(100, Math.round(((reachable - stats.pending) / reachable) * 100))
}

type Translate = (key: string) => string

/** The figures of one campaign: recipients, delivered, read, replied, failed, unsubscribed and held by Meta. */
export function campaignTiles(stats: InboxCampaignStats, t: Translate, locale?: string): KpiTile[] {
  const count = new Intl.NumberFormat(locale)
  const reached = stats.delivered + stats.read
  return [
    { id: 'total', icon: 'i-lucide-users', label: t('inbox.campaigns.stats.total'), value: count.format(stats.total), hint: stats.skipped ? `${t('inbox.campaigns.stats.skipped')}: ${count.format(stats.skipped)}` : undefined },
    { id: 'delivered', icon: 'i-lucide-check-check', label: t('inbox.campaigns.stats.delivered'), value: count.format(reached), tone: reached > 0 ? 'success' : 'neutral' },
    { id: 'read', icon: 'i-lucide-eye', label: t('inbox.campaigns.stats.read'), value: count.format(stats.read) },
    { id: 'replied', icon: 'i-lucide-reply', label: t('inbox.campaigns.stats.replied'), value: count.format(stats.replied) },
    { id: 'failed', icon: 'i-lucide-circle-alert', label: t('inbox.campaigns.stats.failed'), value: count.format(stats.failed), tone: stats.failed > 0 ? 'danger' : 'neutral' },
    { id: 'unsubscribed', icon: 'i-lucide-bell-off', label: t('inbox.campaigns.stats.unsubscribed'), value: count.format(stats.unsubscribed), tone: stats.unsubscribed > 0 ? 'warning' : 'neutral' },
    { id: 'held', icon: 'i-lucide-hourglass', label: t('inbox.campaigns.stats.held'), value: count.format(stats.held), hint: stats.held > 0 ? t('inbox.campaigns.stats.heldHint') : undefined, tone: stats.held > 0 ? 'warning' : 'neutral' },
  ]
}
