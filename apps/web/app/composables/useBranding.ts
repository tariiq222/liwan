import { BrandingSchema, type Branding } from '@nasq/contracts'
import { createBrandTheme } from '@/utils/brandTheme'

export function useBranding() {
  const { data, refresh } = useFetch<Branding>('/api/v1/branding', {
    key: 'branding',
    transform: (raw) => BrandingSchema.parse(raw),
  })
  const branding = computed(() => data.value ?? null)
  const themeStyle = computed(() => Object.entries(createBrandTheme(branding.value?.primary_color ?? ''))
    .map(([key, value]) => `${key}:${value}`)
    .join(';'))
  useHead(() => ({
    title: branding.value?.name ?? 'nasq',
    htmlAttrs: branding.value ? { style: themeStyle.value } : {},
  }))
  return { branding, refresh }
}
