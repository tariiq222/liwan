import { describe, expect, it } from 'vitest'
import { committedName } from '../crmListRename'

const edit = (value: string) => ({ target: { value } }) as unknown as Event

describe('committedName', () => {
  it('returns the trimmed new name', () => {
    expect(committedName(edit('  جديد  '), 'قديم')).toBe('جديد')
  })

  it('returns null when the name did not change', () => {
    expect(committedName(edit('قديم'), 'قديم')).toBeNull()
  })

  it('puts the stored name back into an emptied input and saves nothing', () => {
    const event = edit('   ')
    expect(committedName(event, 'قديم')).toBeNull()
    expect((event.target as HTMLInputElement).value).toBe('قديم')
  })
})
