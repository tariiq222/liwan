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

  it('lets rounded-card replace rounded-xl and rounded-2xl', () => {
    expect(tv({ base: 'rounded-xl p-4' })({ class: 'rounded-card' })).toBe('p-4 rounded-card')
    expect(tv({ base: 'rounded-2xl p-4' })({ class: 'rounded-card' })).toBe('p-4 rounded-card')
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

describe('segmented groups', () => {
  it('are full pills around their pill segments', async () => {
    const { readFileSync } = await import('node:fs')
    const root = new URL('../app/components/shared/', import.meta.url)
    for (const file of ['data/ViewSwitch.vue', 'data/FilterChoice.vue']) {
      const source = readFileSync(new URL(file, root), 'utf8')
      expect(source, file).toMatch(/gap-0\.5 rounded-full/)
    }
  })
})

describe('embedded filter row', () => {
  it('turns every rounded-control inside it into a pill from one CSS hook', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../app/assets/css/components.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\[data-variant="embedded"\] \.rounded-control \{\s*border-radius: 9999px;\s*corner-shape: round;/)
  })

  it('keeps a 14px gutter, a 16px icon and an 8px gap around leading and trailing icons', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../app/assets/css/components.css', import.meta.url), 'utf8')
    expect(css).toContain('.rounded-control[class*="ps-"] { padding-inline-start: 38px; }')
    expect(css).toContain('.rounded-control[class*="pe-"] { padding-inline-end: 38px; }')
    expect(css).toContain('[data-slot="leadingIcon"]')
  })
})
