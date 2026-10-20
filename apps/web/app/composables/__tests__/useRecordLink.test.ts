import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRecordLink } from '../useRecordLink'

const granted = vi.hoisted(() => ({ capabilities: new Set<string>() }))
vi.mock('../useAccess', () => ({ useAccess: () => ({ can: (capability: string) => granted.capabilities.has(capability) }) }))

describe('useRecordLink', () => {
  beforeEach(() => granted.capabilities.clear())

  it('resolves a record to the route its owning application declares', () => {
    granted.capabilities.add('documents.items.read')
    expect(useRecordLink()('document', 12)).toBe('/documents/12')
  })

  it('returns null without the capability of the kind', () => {
    expect(useRecordLink()('document', 12)).toBeNull()
  })

  it('returns null for a kind no application declares', () => {
    granted.capabilities.add('documents.items.read')
    expect(useRecordLink()('order', 12)).toBeNull()
  })
})
