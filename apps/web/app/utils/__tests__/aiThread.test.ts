import { describe, expect, it } from 'vitest'
import type { AiThreadItem } from '@/composables/useAiRun'
import { latestPendingIndex } from '../aiThread'

const summary = { summaryAr: 'أ', summaryEn: 'a' }
const confirm = (state: 'pending' | 'approved' | 'rejected'): AiThreadItem => ({ kind: 'confirm', callId: 'c', tool: 't', input: {}, ...summary, state })
const draft = (state: 'pending' | 'approved' | 'rejected'): AiThreadItem => ({ kind: 'draft', callId: 'd', tool: 't', payload: {}, ...summary, state })

describe('latestPendingIndex', () => {
  it('is -1 when no card is waiting', () => {
    expect(latestPendingIndex([])).toBe(-1)
    expect(latestPendingIndex([{ kind: 'user', text: 'hi' }, confirm('approved'), draft('rejected')])).toBe(-1)
  })

  it('picks the newest pending card, confirm or draft', () => {
    expect(latestPendingIndex([confirm('pending'), draft('pending')])).toBe(1)
    expect(latestPendingIndex([draft('pending'), confirm('pending'), { kind: 'user', text: 'x' }])).toBe(1)
  })

  it('skips resolved cards after a pending one', () => {
    expect(latestPendingIndex([confirm('pending'), draft('approved')])).toBe(0)
  })
})
