import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, DARK_SURFACES } from '../nasqPalette'

// Tailwind v4 default palette steps behind the Nuxt UI semantic colours
// (success: green, warning: yellow, error: red, info/secondary: blue).
const PALETTE: Record<string, Record<number, string>> = {
  success: { 400: '#05df72', 500: '#00c950', 600: '#00a63e', 700: '#008236', 800: '#016630', 900: '#0d542b' },
  warning: { 400: '#fdc700', 500: '#f0b100', 600: '#d08700', 700: '#a65f00', 800: '#894b00', 900: '#733e0a' },
  error: { 400: '#ff6467', 500: '#fb2c36', 600: '#e7000b', 700: '#c10007', 800: '#9f0712', 900: '#82181a' },
  info: { 400: '#51a2ff', 500: '#2b7fff', 600: '#155dfc', 700: '#1447e6', 800: '#193cb8', 900: '#1c398e' },
  secondary: { 400: '#51a2ff', 500: '#2b7fff', 600: '#155dfc', 700: '#1447e6', 800: '#193cb8', 900: '#1c398e' },
}
// Nuxt UI paints the tone at 500 in light mode and 400 in dark mode.
const TONE_STEP = { light: 500, dark: 400 } as const
const SURFACE = { light: '#ffffff', dark: DARK_SURFACES.bg } as const

function tint(colour: string, surface: string, alpha = 0.1) {
  const mixed = [1, 3, 5].map((i) => {
    const c = Number.parseInt(colour.slice(i, i + 2), 16)
    const s = Number.parseInt(surface.slice(i, i + 2), 16)
    return Math.round(c * alpha + s * (1 - alpha)).toString(16).padStart(2, '0')
  })
  return `#${mixed.join('')}`
}

const config = readFileSync(resolve(__dirname, '../../app.config.ts'), 'utf8')
const badge = config.match(/^\s*badge:.*$/m)?.[0] ?? ''

// The text step the badge recipe sets for a tone and mode; the Nuxt UI default otherwise.
function textStep(tone: string, variant: string, mode: 'light' | 'dark'): number {
  const entry = new RegExp(`\\{[^{}]*color: '${tone}'[^{}]*variant: '${variant}'[^{}]*class: '([^']*)'`).exec(badge)
  const classes = entry?.[1]?.split(/\s+/) ?? []
  const prefix = mode === 'dark' ? 'dark:' : ''
  const match = classes.find(c => new RegExp(`^${prefix}text-${tone}-\\d+$`).test(c))
  if (match) return Number(match.split('-').pop())
  return TONE_STEP[mode]
}

describe('subtle and soft badge text contrast', () => {
  for (const variant of ['subtle', 'soft']) {
    for (const tone of Object.keys(PALETTE)) {
      for (const mode of ['light', 'dark'] as const) {
        it(`${tone} ${variant} text reaches 4.5:1 on its tint in ${mode} mode`, () => {
          const background = tint(PALETTE[tone]![TONE_STEP[mode]]!, SURFACE[mode])
          const step = textStep(tone, variant, mode)
          expect(contrastRatio(PALETTE[tone]![step]!, background), `${tone}-${step}`).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }
})

// Solid badges: the recipe sets the fill and the label; light mode is white (or slate-900 on warning) on the 600/700 step.
function solidClasses(tone: string): string[] {
  const entry = new RegExp(`\\{[^{}]*color: '${tone}'[^{}]*variant: 'solid'[^{}]*class: '([^']*)'`).exec(badge)
  return entry?.[1]?.split(/\s+/) ?? []
}
const LABEL: Record<string, string> = { 'text-white': '#ffffff', 'text-slate-900': '#0f172a' }

describe('solid badge contrast', () => {
  for (const tone of Object.keys(PALETTE)) {
    it(`${tone} solid label reaches 4.5:1 on its fill in light mode`, () => {
      const classes = solidClasses(tone)
      const fill = classes.find(c => new RegExp(`^bg-${tone}-\\d+$`).test(c))
      const label = classes.find(c => c in LABEL)
      expect(fill, `${tone} fill class`).toBeDefined()
      expect(label, `${tone} label class`).toBeDefined()
      expect(contrastRatio(LABEL[label!]!, PALETTE[tone]![Number(fill!.split('-').pop())]!)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${tone} solid label reaches 4.5:1 on its fill in dark mode`, () => {
      expect(contrastRatio(DARK_SURFACES.bg, PALETTE[tone]![400]!)).toBeGreaterThanOrEqual(4.5)
      expect(solidClasses(tone)).toEqual(expect.arrayContaining([`dark:bg-${tone}`, 'dark:text-inverted']))
    })
  }
})

describe('badge defaults', () => {
  it('uses the subtle variant unless a call site asks otherwise', () => {
    expect(badge).toContain("defaultVariants: { variant: 'subtle' }")
  })
  it('never renders text under 12px (xs and sm use text-xs)', () => {
    expect(badge).not.toMatch(/text-\[\d/)
    expect(badge).toMatch(/xs: \{ base: 'text-xs\//)
    expect(badge).toMatch(/sm: \{ base: 'text-xs\//)
  })
})
