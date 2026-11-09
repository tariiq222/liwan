import { describe, expect, it } from 'vitest'
import {
  APP_TILES, contrastRatio, DARK_MID_TEXT, DARK_MUTED_TEXT, DARK_PRIMARY_FILL, DARK_PRIMARY_LABEL, DARK_SURFACES, DARK_TEXT,
  INK, LIGHT_BORDER, LIGHT_CANVAS, LIGHT_INK, LIGHT_MID_TEXT, LIGHT_MUTED_TEXT, LIGHT_SIDEBAR, LIGHT_SOFT,
} from '../liwanPalette'

const LIGHT_FILLED = [LIGHT_CANVAS, LIGHT_SIDEBAR, LIGHT_SOFT]
const DARK_FILLED = [DARK_SURFACES.canvas, DARK_SURFACES.sidebar, DARK_SURFACES.bg, DARK_SURFACES.muted, DARK_SURFACES.accented]

describe('LiwanOS ink palette', () => {
  it('keeps white text readable on the ink primary', () => {
    expect(contrastRatio('#ffffff', INK)).toBeGreaterThanOrEqual(7)
  })
  it('keeps ink, the mid tone and secondary text readable on every light surface', () => {
    for (const surface of LIGHT_FILLED) {
      for (const text of [LIGHT_INK, LIGHT_MID_TEXT, LIGHT_MUTED_TEXT]) expect(contrastRatio(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('keeps the dark solid label readable on the light dark-mode fill', () => {
    expect(contrastRatio(DARK_PRIMARY_LABEL, DARK_PRIMARY_FILL)).toBeGreaterThanOrEqual(7)
  })
  it('keeps dark body, mid and secondary text readable on every charcoal surface', () => {
    for (const surface of DARK_FILLED) {
      for (const text of [DARK_TEXT, DARK_MID_TEXT, DARK_MUTED_TEXT, DARK_PRIMARY_FILL]) expect(contrastRatio(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('keeps the hairline visible against the white page', () => {
    expect(contrastRatio(LIGHT_BORDER, LIGHT_CANVAS)).toBeGreaterThan(1.1)
  })
  it('keeps every paid application button shade readable under a white label', () => {
    for (const [app, tile] of Object.entries(APP_TILES)) expect(contrastRatio('#ffffff', tile.action), app).toBeGreaterThanOrEqual(4.5)
  })
})
