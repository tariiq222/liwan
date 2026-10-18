import type { IntegrationState } from '@webvue/contracts'
import { statusBadgeEntry, type StatusBadgeEntry } from '@webvue/ui/app/utils/statusBadge'

const INTEGRATION_STATE_BADGES: Readonly<Record<IntegrationState, StatusBadgeEntry>> = {
  not_configured: { tone: 'neutral', labelKey: 'integrations.state.not_configured' },
  pending: { tone: 'warning', labelKey: 'integrations.state.pending' },
  connected: { tone: 'success', labelKey: 'integrations.state.connected' },
  error: { tone: 'destructive', labelKey: 'integrations.state.error' },
}

/** A connection's state as a status badge; a state a newer server adds reads neutral with its raw value. */
export function integrationStateBadge(state: string): StatusBadgeEntry {
  return statusBadgeEntry(INTEGRATION_STATE_BADGES, state)
}
