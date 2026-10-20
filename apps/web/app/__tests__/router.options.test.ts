import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberSpyHash } from '../composables/nav/settingsScroll'
import routerOptions from '../router.options'

// The scroll behaviour of hash navigation on a settings page, with a stand-in document.
type Scroll = (to: unknown, from: unknown, saved: unknown) => Promise<unknown>
const scrollBehavior = (routerOptions as unknown as { scrollBehavior: Scroll }).scrollBehavior
const card = { id: 'contact' }
const route = (path: string, hash = '') => ({ path, hash, fullPath: `${path}${hash}`, meta: {} })

beforeEach(() => {
  vi.stubGlobal('document', { querySelector: (selector: string) => (selector === '#contact' ? card : null), documentElement: { scrollHeight: 3000 } })
  vi.stubGlobal('window', { scrollY: 0, innerHeight: 800, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('getComputedStyle', () => ({ scrollMarginTop: '88px' }))
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => { run(); return 0 })
})
afterEach(() => { vi.unstubAllGlobals(); rememberSpyHash('') })

describe('router scroll on a settings page', () => {
  it('scrolls smoothly to a new hash on the page already open, below the header', async () => {
    expect(await scrollBehavior(route('/settings/company', '#contact'), route('/settings/company', '#profile'), null)).toEqual({ el: card, top: 88, behavior: 'smooth' })
  })

  it('leaves the page where it is when the hash is the one the spy wrote, or did not change (a filter)', async () => {
    rememberSpyHash('#contact')
    expect(await scrollBehavior(route('/settings/company', '#contact'), route('/settings/company', '#profile'), null)).toBe(false)
    rememberSpyHash('')
    expect(await scrollBehavior(route('/settings/company', '#contact'), route('/settings/company', '#contact'), null)).toBe(false)
  })

  it('lands a direct link instantly on the card, below the header', async () => {
    expect(await scrollBehavior(route('/settings/company', '#contact'), route('/'), null)).toEqual({ el: card, top: 88, behavior: 'instant' })
  })

  it('does nothing for a hash that names no element on the same page', async () => {
    expect(await scrollBehavior(route('/settings/company', '#nope'), route('/settings/company', '#profile'), null)).toBe(false)
  })
})
