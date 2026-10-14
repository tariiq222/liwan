import { describe, expect, it } from 'vitest'
import { contrastRatio, DARK_SURFACES, NASQ_LIME, NASQ_LIME_FOREGROUND, NASQ_MIDNIGHT } from '../nasqPalette'

describe('Nasq palette', () => {
  it('keeps white text readable on the midnight rail', () => {
    expect(contrastRatio('#ffffff', NASQ_MIDNIGHT)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps midnight text readable on lime fills', () => {
    expect(contrastRatio(NASQ_LIME_FOREGROUND, NASQ_LIME)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps lime visible as a bar on the rail', () => {
    expect(contrastRatio(NASQ_LIME, NASQ_MIDNIGHT)).toBeGreaterThanOrEqual(3)
  })
  it('keeps light body text readable on every dark surface', () => {
    for (const surface of [DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.elevated, DARK_SURFACES.accented]) {
      expect(contrastRatio('#e2e8f0', surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio('#94a3b8', surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
