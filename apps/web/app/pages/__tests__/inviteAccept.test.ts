import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverLocaleFiles } from '../../../i18n/localeFiles'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const page = read('app/pages/invite/accept.vue')

describe('invite accept page', () => {
  it('is public, reads ?token, validates length and uses UFormField', () => {
    expect(page).toContain('route.query.token')
    expect(page).toContain('MIN_LENGTH = 12')
    expect(page.match(/<UFormField/g)?.length).toBe(2)
    expect(page).toContain('useHydrated')
    expect(read('app/middleware/auth.global.ts')).toContain("'/invite/accept'")
  })
  it('handles invalid, unavailable and success states with login link', () => {
    for (const s of ['invalid', 'unavailable', 'success']) expect(page).toContain(`'${s}'`)
    expect(page).toContain("path: '/login'")
    expect(page).not.toMatch(/console\./)
  })
  it('uses logical properties only and registers both locales', () => {
    expect(page).not.toMatch(/\b(ml|mr|pl|pr)-\d/)
    const files = discoverLocaleFiles(resolve(root, 'i18n/locales'))
    expect(files.ar).toContain('ar/invite.json'); expect(files.en).toContain('en/invite.json')
    const keys = (l: string) => Object.keys(JSON.parse(read(`i18n/locales/${l}/invite.json`)).invite).sort()
    expect(keys('ar')).toEqual(keys('en'))
  })
})
