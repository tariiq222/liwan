import { describe, expect, it } from 'vitest'
import { createTV } from 'tailwind-variants'

type AppConfigStub = { ui: { tv: Parameters<typeof createTV>[0] } & Record<string, unknown> }
const globals = globalThis as unknown as { defineAppConfig: (config: AppConfigStub) => AppConfigStub }
globals.defineAppConfig = config => config
const { default: appConfig } = await import('../app/app.config') as unknown as { default: AppConfigStub }

const tv = createTV(appConfig.ui.tv)

describe('radius tokens in the tailwind-merge conflict group', () => {
  it('lets rounded-control replace the stock rounded-md', () => {
    const input = tv({ slots: { base: 'rounded-md px-2.5' } })
    expect(input({ class: undefined }).base({ class: 'rounded-control' })).toBe('px-2.5 rounded-control')
  })

  it('lets rounded-inner and rounded-surface replace stock radii', () => {
    expect(tv({ base: 'rounded-lg p-4' })({ class: 'rounded-inner' })).toBe('p-4 rounded-inner')
    expect(tv({ base: 'rounded-xl p-4' })({ class: 'rounded-surface' })).toBe('p-4 rounded-surface')
  })

  it('lets rounded-card replace rounded-xl and rounded-2xl', () => {
    expect(tv({ base: 'rounded-xl p-4' })({ class: 'rounded-card' })).toBe('p-4 rounded-card')
    expect(tv({ base: 'rounded-2xl p-4' })({ class: 'rounded-card' })).toBe('p-4 rounded-card')
  })

  it('lets the size-scale shapes replace the control default', () => {
    for (const shape of ['inner', 'tile']) {
      expect(tv({ base: 'rounded-control p-4' })({ class: `rounded-${shape}` }), shape).toBe(`p-4 rounded-${shape}`)
    }
  })

  it('keeps side-specific radii independent of the token', () => {
    expect(tv({ base: 'rounded-control' })({ class: 'rounded-t-none' })).toBe('rounded-control rounded-t-none')
  })

  it('leaves no stock radius in the control and surface recipes', () => {
    const ui = appConfig.ui as unknown as Record<string, { slots?: Record<string, string> }>
    for (const name of ['input', 'inputNumber', 'textarea', 'select', 'selectMenu', 'dropdownMenu', 'popover', 'tooltip', 'modal', 'card']) {
      const classes = Object.values(ui[name]?.slots ?? {}).join(' ')
      expect(classes, name).not.toMatch(/\brounded-(sm|md|lg|xl|2xl|3xl)\b/)
    }
  })
})

describe('radius scale tokens', () => {
  it('defines four radius steps: card and surface 18, control 12, inner 8, tile 28%', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../app/assets/css/tokens.css', import.meta.url), 'utf8')
    const px = (name: string) => Number(new RegExp(`--radius-${name}: ([\\d.]+)rem;`).exec(css)?.[1]) * 14
    expect(css).toContain('--radius-tile: min(28%, 18px);')
    expect(Object.fromEntries(['surface', 'card', 'control', 'inner'].map(name => [name, Math.round(px(name))])))
      .toEqual({ surface: 18, card: 18, control: 12, inner: 8 })
  })

  it('gives the squircle corner to every shape class where supported', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../app/assets/css/components.css', import.meta.url), 'utf8')
    expect(css).toContain('@supports (corner-shape: squircle)')
    for (const selector of ['.rounded-tile', '.rounded-control', '.rounded-inner', '.liwan-app-tile']) expect(css).toContain(selector)
  })
})

describe('segmented groups', () => {
  it('are 12px groups around 8px inner segments', async () => {
    const { readFileSync } = await import('node:fs')
    const root = new URL('../app/components/shared/', import.meta.url)
    for (const file of ['data/SegmentedControl.vue']) {
      const source = readFileSync(new URL(file, root), 'utf8')
      expect(source, file).toMatch(/gap-0\.5 rounded-control/)
      expect(source, file).toContain('rounded-inner')
    }
  })
})

describe('embedded filter row', () => {
  it('keeps the 12px control radius (no pill override)', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../app/assets/css/components.css', import.meta.url), 'utf8')
    expect(css).not.toMatch(/\[data-variant="embedded"\] \.rounded-control \{[^}]*border-radius/)
  })

  it('keeps a 14px gutter, a 16px icon and an 8px gap around leading and trailing icons', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../app/assets/css/components.css', import.meta.url), 'utf8')
    expect(css).toContain('.rounded-control[class*="ps-"] { padding-inline-start: 38px; }')
    expect(css).toContain('.rounded-control[class*="pe-"] { padding-inline-end: 38px; }')
    expect(css).toContain('[data-slot="leadingIcon"]')
  })
})
