import type { InboxAgent } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

/** What an agent's availability reads as: the manual switch decides first, then the shift. */
export type InboxAgentStatus = 'available' | 'unavailable' | 'off_shift'

export function inboxAgentStatus(agent: Pick<InboxAgent, 'available' | 'in_shift'>): InboxAgentStatus {
  if (!agent.available) return 'unavailable'
  return agent.in_shift ? 'available' : 'off_shift'
}

export const INBOX_AGENT_STATUS_TONE: Record<InboxAgentStatus, StatusTone> = { available: 'success', unavailable: 'neutral', off_shift: 'warning' }

/** The name an agent picker shows: the name, then the status when the agent is not available now. */
export function inboxAgentOptionName(agent: InboxAgent, t: (key: string) => string): string {
  return agent.effective_available ? agent.name : `${agent.name} · ${t(`inbox.agentStatus.${inboxAgentStatus(agent)}`)}`
}
