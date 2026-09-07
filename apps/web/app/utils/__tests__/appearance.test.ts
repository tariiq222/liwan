import { describe, expect, it } from 'vitest'
import { normalizeAppearance } from '../appearance'

describe('saved appearance preferences', () => {
  it.each([undefined, null, '', 'dark', [], 42])('uses safe defaults for malformed storage %j', (input) => {
    expect(normalizeAppearance(input)).toEqual({ mode: 'light', fontSize: 'small' })
  })

  it('keeps a valid preference when the other field is invalid', () => {
    expect(normalizeAppearance({ mode: 'dark', fontSize: 'huge' })).toEqual({ mode: 'dark', fontSize: 'small' })
    expect(normalizeAppearance({ mode: 'cream', fontSize: 'medium' })).toEqual({ mode: 'cream', fontSize: 'medium' })
    expect(normalizeAppearance({ mode: 'system', fontSize: 'large' })).toEqual({ mode: 'light', fontSize: 'large' })
  })

  it.each(['small', 'medium', 'large'])('restores the chosen %s font with dark mode and drops unknown attributes', (fontSize) => {
    expect(normalizeAppearance({ mode: 'dark', fontSize, extra: 'ignored' })).toEqual({ mode: 'dark', fontSize })
  })
})
