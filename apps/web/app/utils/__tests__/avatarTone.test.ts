import { describe, expect, it } from 'vitest'
import { avatarInitials, avatarTone, AVATAR_TONE_COUNT } from '../avatarTone'

describe('avatarTone', () => {
  it('is deterministic and uses all eight hues over consecutive ids', () => {
    expect(avatarTone(5)).toEqual(avatarTone(5))
    const hues = new Set(Array.from({ length: AVATAR_TONE_COUNT }, (_, i) => avatarTone(i + 1).hue))
    expect(hues.size).toBe(8)
  })

  it('gives a light and a dark colour from the tone hue variable', () => {
    for (let id = 0; id < AVATAR_TONE_COUNT; id += 1) {
      const tone = avatarTone(id)
      expect(tone.style['--avatar-hue']).toBe(String(tone.angle))
      expect(tone.class).toMatch(/(?:^| )bg-\[oklch\(.*var\(--avatar-hue\)\)\]/)
      expect(tone.class).toContain('dark:bg-[oklch(')
      expect(tone.class).toContain('dark:text-[oklch(')
    }
    expect(new Set(Array.from({ length: AVATAR_TONE_COUNT }, (_, i) => avatarTone(i).angle)).size).toBe(8)
  })

  it('handles missing and text ids without throwing', () => {
    expect(avatarTone(null).class).toBeTruthy()
    expect(avatarTone('abc')).toEqual(avatarTone('abc'))
    expect(avatarTone(-3)).toEqual(avatarTone(3))
  })
})

describe('avatarInitials', () => {
  it('takes the first letters of the first and last Arabic words', () => {
    expect(avatarInitials('سارة محمد العلي')).toBe('سع')
    expect(avatarInitials('  خالد   أحمد ')).toBe('خأ')
  })

  it('handles one word, Latin names and empty input', () => {
    expect(avatarInitials('سارة')).toBe('س')
    expect(avatarInitials('sara al ali')).toBe('SA')
    expect(avatarInitials('')).toBe('')
    expect(avatarInitials(null)).toBe('')
    expect(avatarInitials('- ()')).toBe('')
  })
})
