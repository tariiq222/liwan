import { IntegrationStateSchema } from '@liwan/contracts'
import { describe, expect, it } from 'vitest'
import { integrationStateBadge } from '../integrationStateBadge'

describe('integrationStateBadge', () => {
  it('names a tone and a label key for every state the contract allows', () => {
    for (const state of IntegrationStateSchema.options) {
      const entry = integrationStateBadge(state)
      expect(entry.labelKey, state).toBe(`integrations.state.${state}`)
    }
    expect(integrationStateBadge('connected').tone).toBe('success')
    expect(integrationStateBadge('error').tone).toBe('destructive')
    expect(integrationStateBadge('pending').tone).toBe('warning')
    expect(integrationStateBadge('not_configured').tone).toBe('neutral')
  })

  it('reads neutral with no key for a state a newer server adds', () => {
    expect(integrationStateBadge('suspended')).toEqual({ tone: 'neutral', labelKey: '' })
  })
})
