import { BrandingSchema, type Branding } from '@liwan/contracts'

const DEFAULT_ICONS = [
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
  { rel: 'icon', type: 'image/x-icon', sizes: '32x32', href: '/favicon.ico' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
] as const

export function useBranding() {
  const { data, refresh } = useFetch<Branding>('/api/v1/branding', {
    key: 'branding',
    transform: (raw) => BrandingSchema.parse(raw),
  })
  const branding = computed(() => data.value ?? null)
  const faviconUrl = computed(() => {
    const logo = branding.value?.logo_url
    if (!logo?.startsWith('/web/binary/company_logo?')) return logo
    const params = new URLSearchParams(logo.split('?')[1])
    const company = params.get('company')
    if (!company || !/^[1-9]\d*$/.test(company)) return logo
    const version = params.get('v')
    const query = version ? `?${new URLSearchParams({ v: version })}` : ''
    // Odoo fits the original logo within 32px without cropping or stretching.
    // Keep its version so a replacement logo also invalidates the tab icon.
    return `/web/image/res.company/${company}/logo/32x32${query}`
  })
  // The one owner of the tab icon: the tenant's logo when it has one, the LiwanOS icons otherwise.
  useHead(() => ({
    title: branding.value?.name ?? 'liwan',
    link: faviconUrl.value ? [{ key: 'institution-favicon', rel: 'icon', href: faviconUrl.value }] : [...DEFAULT_ICONS],
  }))
  return { branding, refresh }
}
