import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// A source guard for the two-step sign-in page and its step component. Behaviour is pinned by the component,
// flow and wire tests; this pins the decisions a refactor could silently regress, and the couplings the e2e spec
// depends on (the send → code-field → verify sequence).
const app = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(app, path), 'utf8')
const page = read('pages/login.vue')
const step = read('components/auth/LoginCodeStep.vue')

describe('the sign-in page', () => {
  it('keeps the standalone card, its brand slot and the prefilled username', () => {
    expect(page).toContain('<SharedStandalonePage surface="brand"')
    expect(page).toContain('<SharedBrandWordmark')
    expect(page).not.toContain('<main')
    expect(page).toContain('route.query.login')
    expect(page).toContain('useHydrated')
    expect(page).toContain("access: 'guest'")
  })

  it('has no authenticator step left anywhere', () => {
    for (const source of [page, step]) {
      expect(source).not.toMatch(/totp/i)
      expect(source).not.toMatch(/authenticator/i)
    }
  })

  it('continues the password step with the code step, and only on the server answer', () => {
    expect(page).toContain('LoginStepSchema.parse')
    expect(page).toContain("'/api/auth/login'")
    expect(page).toContain("'/api/auth/channels'")
    expect(page).toContain("'/api/auth/code'")
    expect(page).toContain("'/api/auth/verify'")
  })

  it('treats the remembered-device hop as an optimisation that can never block the code step', () => {
    // A throwing device hop would leave a person with a working code unable to sign in.
    const device = page.slice(page.indexOf('async function rememberedDevice'))
    const body = device.slice(0, device.indexOf('\n}\n') + 3)
    expect(body).toContain("$fetch('/api/auth/device'")
    expect(body).toMatch(/catch \{ return null \}/)
    expect(body).not.toMatch(/throw/)
  })

  it('never hardcodes a resend window, a code length or a destination', () => {
    expect(page).toContain('sent.value.resend_after')
    expect(page).not.toMatch(/\b60\b/)
    expect(step).not.toMatch(/\b60\b/)
    // The six digits come from the contract's own check, not a literal in the template.
    expect(step).toContain('isCompleteCode')
    expect(step).not.toMatch(/\{6\}|maxlength="6"/)
  })

  it('asks the code with the platform one-time-code affordances and a left-to-right field', () => {
    expect(step).toContain('autocomplete="one-time-code"')
    expect(step).toContain('inputmode="numeric"')
    expect(step).toContain('dir="ltr"')
    expect(step).toContain('id="login-code"')
  })

  it('uses logical RTL properties only', () => {
    for (const source of [page, step]) expect(source).not.toMatch(/\b(?:ml|mr|pl|pr)-(?:\d|px|auto)/)
  })

  it('asks every user-facing string through t()', () => {
    expect(page).toContain("$t('auth.password')")
    expect(step).toContain("t('auth.rememberDevice')")
    expect(step).toContain("t('auth.useAnotherAccount')")
  })
})

describe('the account settings page', () => {
  const settings = read('pages/account/settings.vue')
  const section = read('components/account/RememberedDevicesSection.vue')

  it('shows the remembered devices on the settings template', () => {
    expect(settings).toContain('<SharedSettingsPage')
    expect(settings).toContain('<RememberedDevicesSection')
  })

  it('confirms forgetting devices inline, never in a dialog', () => {
    expect(section).toContain('<SharedInlineConfirm')
    expect(section).not.toMatch(/<\/?(?:Dialog|AlertDialog|Sheet|Drawer|UModal)\b/)
    expect(section).toContain('useForgetDevices')
  })
})
