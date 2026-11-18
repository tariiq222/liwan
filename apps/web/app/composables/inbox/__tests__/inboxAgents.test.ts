import { describe, expect, it } from 'vitest'
import { inboxAgentOptionName, inboxAgentStatus } from '../inboxAgents'

const agent = { id: 4, name: 'منى', available: true, in_shift: true, effective_available: true }
const t = (key: string) => key

describe('inbox agent status', () => {
  it('reads the manual switch first, then the shift', () => {
    expect(inboxAgentStatus(agent)).toBe('available')
    expect(inboxAgentStatus({ ...agent, in_shift: false })).toBe('off_shift')
    expect(inboxAgentStatus({ ...agent, available: false })).toBe('unavailable')
    expect(inboxAgentStatus({ ...agent, available: false, in_shift: false })).toBe('unavailable')
  })

  it('names the status in the picker only for an agent who is not available now', () => {
    expect(inboxAgentOptionName(agent, t)).toBe('منى')
    expect(inboxAgentOptionName({ ...agent, available: false, effective_available: false }, t)).toBe('منى · inbox.agentStatus.unavailable')
    expect(inboxAgentOptionName({ ...agent, in_shift: false, effective_available: false }, t)).toBe('منى · inbox.agentStatus.off_shift')
  })
})
