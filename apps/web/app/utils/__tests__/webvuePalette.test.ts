import { describe, expect, it } from 'vitest'
import {
  contrastRatio, DARK_PRIMARY_ACCENT, DARK_PRIMARY_FILL, DARK_SAND, DARK_SURFACES, DARK_TEXT,
  LIGHT_ACTIVE_TINT, LIGHT_CANVAS, LIGHT_INK, LIGHT_MUTED_TEXT, LIGHT_SAND, WEBVUE_BLUE,
} from '../webvuePalette'

const DARK_FILLED = [DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.elevated, DARK_SURFACES.accented, DARK_SURFACES.canvas]

describe('WebVue palette', () => {
  it('keeps white text readable on the lavender primary', () => {
    expect(contrastRatio('#ffffff', WEBVUE_BLUE)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps the primary readable as text on white, canvas and the active tint', () => {
    for (const surface of ['#ffffff', LIGHT_CANVAS, LIGHT_ACTIVE_TINT]) expect(contrastRatio(WEBVUE_BLUE, surface), surface).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps ink readable on white, canvas and sand', () => {
    for (const surface of ['#ffffff', LIGHT_CANVAS, LIGHT_SAND]) expect(contrastRatio(LIGHT_INK, surface), surface).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps brown secondary text readable on white, canvas, sand and the active tint', () => {
    for (const surface of ['#ffffff', LIGHT_CANVAS, LIGHT_SAND, LIGHT_ACTIVE_TINT]) expect(contrastRatio(LIGHT_MUTED_TEXT, surface), surface).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps white text readable on the dark text-bearing fill', () => {
    expect(contrastRatio('#ffffff', DARK_PRIMARY_FILL)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps the dark lavender accent, body text and sand readable on every dark surface', () => {
    for (const surface of DARK_FILLED) {
      expect(contrastRatio(DARK_PRIMARY_ACCENT, surface), `accent ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(DARK_TEXT, surface), `text ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(DARK_SAND, surface), `sand ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
