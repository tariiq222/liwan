import { describe, expect, it } from 'vitest'
import { committedName } from '../settingsListName'

const input = (value: string) => ({ value }) as HTMLInputElement

describe('committedName', () => {
  it('saves a trimmed new name', () => {
    expect(committedName(input('  جديد  '), 'قديم')).toBe('جديد')
  })

  it('saves nothing when the name did not change', () => {
    expect(committedName(input('قديم'), 'قديم')).toBeNull()
  })

  it('puts the stored name back into an emptied input and saves nothing', () => {
    const emptied = input('   ')
    expect(committedName(emptied, 'قديم')).toBeNull()
    expect(emptied.value).toBe('قديم')
  })
})
