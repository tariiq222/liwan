import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverLocaleFiles } from '@liwan/ui/i18n/localeFiles'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const page = read('app/pages/invite/accept.vue')

describe('invite accept page', () => {
  it('is public, reads the token from the hash and uses UFormField', () => {
    expect(page).toContain('<SharedStandalonePage')
    expect(page).not.toContain('<main')
    expect(page).toContain('window.location.hash')
    expect(page).toContain('history.replaceState')
    expect(page).not.toContain('route.query.token')
    expect(page).toContain('MIN_LENGTH = 12')
    expect(page.match(/<UFormField/g)?.length).toBe(2)
    expect(page).toContain('useHydrated')
    expect(page).toContain("access: 'public'")
  })
  it('handles invalid, unavailable and success states with login link', () => {
    for (const s of ['invalid', 'success']) expect(page).toContain(`'${s}'`)
    expect(page).toContain("path: '/login'")
    expect(page).not.toMatch(/console\./)
  })
  it('keeps the form for a refused password or a running acceptance and stops on an unavailable account', () => {
    for (const code of ['password_rejected', 'in_progress', 'account_unavailable']) expect(page).toContain(`'${code}'`)
    expect(page).toContain("state === 'accountUnavailable'")
    expect(page).toMatch(/<form v-else-if="state === 'form'"[\s\S]*v-if="formError"[\s\S]*<\/form>/)
  })
  it('keeps the form and the typed password on a 503 or network failure and offers retry', () => {
    expect(page).toContain("formError.value = 'unavailable'; keepPassword = true")
    expect(page).toContain('if (!keepPassword)')
    expect(page).toContain("t('invite.retry')")
    expect(page).not.toContain("state.value = 'unavailable'")
    expect(page).toMatch(/<form v-else-if="state === 'form'"[\s\S]*v-if="formError"[\s\S]*<\/form>/)
  })
  it('checks the link before showing the form and falls back to the form when the check is unavailable', () => {
    expect(page).toContain("'/api/invitations/check'")
    expect(page).toContain("state.value = res?.usable === true ? 'form' : 'invalid'")
    expect(page).toMatch(/catch \{\s*state\.value = 'form'/)
    expect(page).toContain("v-if=\"state === 'checking'\"")
    expect(page).toMatch(/<form v-else-if="state === 'form'"/)
  })
  it('offers sign-in and forgot-password when the link cannot be used, and no new-invitation form', () => {
    expect(page).toContain("ref<'checking' | 'form' | 'invalid' | 'accountUnavailable' | 'success'>(token.value ? 'checking' : 'invalid')")
    expect(page).toContain("state === 'invalid'")
    expect(page).not.toContain("'/api/invitations/reissue'")
    expect(page).not.toContain('invite.resend')
    expect(page).toContain('to="/login"')
    expect(page).toContain('to="/forgot-password"')
    expect(page).not.toMatch(/console\./)
  })
  it('no longer links the sign-in page to a new-invitation request', () => {
    const login = read('app/pages/login.vue')
    expect(login).not.toContain('inviteRequestable')
    expect(login).not.toContain('invite.didNotReceive')
  })
  it('prefills the login page username from ?login, sanitized', () => {
    const login = read('app/pages/login.vue')
    expect(login).toContain('route.query.login')
    expect(login).toMatch(/reactive\(\{ login: queryLogin/)
    expect(login).toContain('.slice(0, 128)')
  })
  it('uses logical properties only and registers both locales', () => {
    expect(page).not.toMatch(/\b(ml|mr|pl|pr)-\d/)
    const files = discoverLocaleFiles(resolve(root, 'i18n/locales'))
    expect(files.ar).toContain('ar/invite.json'); expect(files.en).toContain('en/invite.json')
    const keys = (l: string) => Object.keys(JSON.parse(read(`i18n/locales/${l}/invite.json`)).invite).sort()
    expect(keys('ar')).toEqual(keys('en'))
  })
})
