import { describe, expect, it } from 'vitest'

type AlertRecipe = { defaultVariants?: { variant?: string }, compoundVariants?: { color: string, variant: string, class: { root: string } }[] }
type AppConfigStub = { ui: Record<string, unknown> }
const globals = globalThis as unknown as { defineAppConfig: (config: AppConfigStub) => AppConfigStub }
globals.defineAppConfig = config => config
const { default: appConfig } = await import('../app/app.config') as unknown as { default: AppConfigStub }
const alert = appConfig.ui.alert as AlertRecipe

describe('the alert recipe', () => {
  it('is subtle by default: the stock solid fill gives white text on saturated amber and red', () => {
    expect(alert.defaultVariants?.variant).toBe('subtle')
  })

  it('reads its status text from the same contrast-checked tokens as badges', () => {
    const subtle = Object.fromEntries((alert.compoundVariants ?? []).filter(item => item.variant === 'subtle').map(item => [item.color, item.class.root]))
    expect(subtle).toEqual({
      success: 'text-status-success-foreground',
      info: 'text-status-info-foreground',
      warning: 'text-status-warning-foreground',
      error: 'text-status-danger-foreground',
    })
  })
})
