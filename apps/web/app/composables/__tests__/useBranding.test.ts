import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBranding } from '../useBranding'

afterEach(() => vi.unstubAllGlobals())

describe('institution favicon', () => {
  function setup(logoUrl = '/web/binary/company_logo?company=7&v=first') {
    const data = ref<null | { name: string, logo_url: string, primary_color: string, secondary_color?: string | null, font: string }>({
      name: 'Institution', logo_url: logoUrl, primary_color: '#001A33', secondary_color: '#d14a00', font: 'IBM_Plex_Sans_Arabic',
    })
    let head: () => { link?: { rel: string, href: string }[] }
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useFetch', () => ({ data, refresh: async () => {} }))
    vi.stubGlobal('useHead', (input: typeof head) => { head = input })
    useBranding()
    return { data, head: () => head() }
  }

  it('uses the saved company logo at a tab-sized resolution', () => {
    const { head } = setup()
    expect(head().link).toContainEqual(expect.objectContaining({
      rel: 'icon', href: '/web/image/res.company/7/logo/32x32?v=first',
    }))
  })

  it('changes the icon URL when a replacement logo is loaded', () => {
    const { head, data } = setup()
    data.value!.logo_url = '/web/binary/company_logo?company=7&v=replaced'
    expect(head().link).toContainEqual(expect.objectContaining({
      rel: 'icon', href: '/web/image/res.company/7/logo/32x32?v=replaced',
    }))
  })

  it('emits no static LiwanOS icon while the tenant has a logo', () => {
    const { head } = setup()
    expect(head().link).toHaveLength(1)
    expect(head().link).not.toContainEqual(expect.objectContaining({ href: '/favicon.svg' }))
    expect(head().link).not.toContainEqual(expect.objectContaining({ rel: 'apple-touch-icon' }))
  })

  it('falls back to the three LiwanOS icons, not an old institution icon, when branding is unavailable', () => {
    const { head, data } = setup()
    data.value = null
    expect(head().link!.map(link => link.href)).toEqual(['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png'])
  })

  it('keeps other logo sources usable without inventing a company id', () => {
    const { head } = setup('/brand/logo.png?v=2')
    expect(head().link).toContainEqual(expect.objectContaining({ rel: 'icon', href: '/brand/logo.png?v=2' }))
  })

  it('never themes the interface from the stored company colours', () => {
    const { head, data } = setup()
    expect(head()).not.toHaveProperty('htmlAttrs')
    data.value = { ...data.value!, primary_color: '#00ff00', secondary_color: '#ff0000' }
    expect(head()).not.toHaveProperty('htmlAttrs')
  })
})
