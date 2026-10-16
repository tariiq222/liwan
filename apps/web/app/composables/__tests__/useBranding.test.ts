import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBranding } from '../useBranding'

vi.mock('@/utils/brandTheme', () => import('../../utils/brandTheme'))

afterEach(() => vi.unstubAllGlobals())

describe('institution favicon', () => {
  function setup(logoUrl = '/web/binary/company_logo?company=7&v=first') {
    const data = ref<null | { name: string, logo_url: string, primary_color: string, secondary_color?: string | null, font: string }>({
      name: 'Institution', logo_url: logoUrl, primary_color: '#001A33', secondary_color: '#d14a00', font: 'IBM_Plex_Sans_Arabic',
    })
    let head: () => { link?: { rel: string, href: string }[] }
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useAppearance', () => ({ mode: ref('light') }))
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

  it('does not keep an old institution icon when branding is unavailable', () => {
    const { head, data } = setup()
    data.value = null
    expect(head().link).toEqual([])
  })

  it('keeps other logo sources usable without inventing a company id', () => {
    const { head } = setup('/brand/logo.png?v=2')
    expect(head().link).toContainEqual(expect.objectContaining({ rel: 'icon', href: '/brand/logo.png?v=2' }))
  })

  it('renders the primary family and ignores a stored secondary color', () => {
    let head!: () => { htmlAttrs?: { style?: string }, link?: { rel: string, href: string }[] }
    const data = ref<null | { name: string, logo_url: string, primary_color: string, secondary_color?: string | null, font: string }>({
      name: 'Institution', logo_url: '/brand/logo.png', primary_color: '#001A33', secondary_color: '#d14a00', font: 'IBM_Plex_Sans_Arabic',
    })
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useAppearance', () => ({ mode: ref('light') }))
    vi.stubGlobal('useFetch', () => ({ data, refresh: async () => {} }))
    vi.stubGlobal('useHead', (input: typeof head) => { head = input })
    useBranding()
    const style = head().htmlAttrs?.style ?? ''
    expect(style).toContain('--primary-fill:')
    expect(style).not.toContain('--webvue-brand-secondary')
    expect(style).not.toMatch(/(?:^|;)--secondary:/)
    expect(style).not.toContain('#2563eb')
    data.value = { ...data.value!, secondary_color: '#00ff00' }
    expect(head().htmlAttrs?.style).toBe(style)
  })
})
