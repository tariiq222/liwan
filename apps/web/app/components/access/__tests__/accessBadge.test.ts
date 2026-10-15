import { describe, expect, it } from 'vitest'
import { accessBadge } from '../accessBadge'

describe('accessBadge', () => {
  it('shows protected as a locked info badge, never the success tone', () => {
    expect(accessBadge({ active: true, protected: true })).toMatchObject({ tone: 'info', labelKey: 'access.protected', icon: 'i-lucide-lock' })
  })
  it('keeps the shared map for the other states', () => {
    expect(accessBadge({ active: true })).toMatchObject({ tone: 'success', labelKey: 'access.active' })
    expect(accessBadge({ active: false })).toMatchObject({ tone: 'warning', labelKey: 'access.disabled' })
  })
})
