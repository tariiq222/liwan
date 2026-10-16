import { BrandingSchema, type Branding } from '@webvue/contracts'
import { createBrandTheme } from '@/utils/brandTheme'

export function useBranding() {
  const { mode } = useAppearance()
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
  const themeStyle = computed(() => Object.entries(createBrandTheme(
    branding.value?.primary_color ?? '',
    mode.value,
  ))
    .map(([key, value]) => `${key}:${value}`)
    .join(';'))
  useHead(() => ({
    title: branding.value?.name ?? 'webvue',
    link: faviconUrl.value ? [{ key: 'institution-favicon', rel: 'icon', href: faviconUrl.value }] : [],
    htmlAttrs: { style: themeStyle.value },
  }))
  return { branding, refresh }
}
