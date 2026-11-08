import type { AppCardSurface } from '../../modules/types'

/**
 * The gradient of an application card on home (owner design). Colours are [from, to] of a 170deg gradient: the first pair
 * in light mode, the second in dark mode. `lightText` is true where the card is dark even in light mode (white text).
 */
interface SurfaceColours { light: readonly [string, string]; dark: readonly [string, string]; lightText: boolean }

const SURFACES: Record<AppCardSurface, SurfaceColours> = {
  navy: { light: ['#1c2b4a', '#0f1a33'], dark: ['#1c2b4a', '#0c1428'], lightText: true },
  mint: { light: ['#e4fbf2', '#b4f0d7'], dark: ['#12402f', '#0a2219'], lightText: false },
  lav: { light: ['#f5f5f7', '#dcdce3'], dark: ['#34343d', '#27272e'], lightText: false },
  sand: { light: ['#f8f8f9', '#e4e4e9'], dark: ['#34343d', '#27272e'], lightText: false },
  indigo: { light: ['#e8eafd', '#c3c8f6'], dark: ['#222861', '#13163a'], lightText: false },
  coral: { light: ['#fdeae6', '#f7c4b9'], dark: ['#4a221c', '#26120f'], lightText: false },
  forest: { light: ['#163d2c', '#0d2a1e'], dark: ['#174532', '#0b2219'], lightText: true },
  lime: { light: ['#f3f9e1', '#d9eda4'], dark: ['#2f3f10', '#182108'], lightText: false },
}

/** CSS variables the card's gradient classes read, and whether its text is white in light mode. */
export function appCardSurface(surface: AppCardSurface): { style: Record<string, string>; lightText: boolean } {
  const colours = SURFACES[surface]
  return {
    style: { '--card-from': colours.light[0], '--card-to': colours.light[1], '--card-from-dark': colours.dark[0], '--card-to-dark': colours.dark[1] },
    lightText: colours.lightText,
  }
}
