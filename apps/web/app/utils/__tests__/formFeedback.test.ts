import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { saveErrorMessage } from '../formFeedback'

describe('save feedback', () => {
  it('distinguishes an unconfirmed write from a server rejection', () => {
    expect(saveErrorMessage(new ApiError(0, 'http_error', 'connection failed'), 'Failed', 'Outcome unknown')).toBe('Outcome unknown')
    expect(saveErrorMessage(new ApiError(422, 'invalid', 'Check the name'), 'Failed', 'Outcome unknown')).toBe('Check the name')
  })
  it('does not expose an unexpected client or contract exception as a user instruction', () => {
    expect(saveErrorMessage(new Error('internal schema trace'), 'Failed', 'Outcome unknown')).toBe('Failed')
  })
})
