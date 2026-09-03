import { BrandingSchema, type Branding } from '@nasq/contracts'

export function useBranding() {
  const { data } = useFetch<Branding>('/api/v1/branding', {
    key: 'branding',
    transform: (raw) => BrandingSchema.parse(raw),
  })
  const branding = computed(() => data.value ?? null)
  useHead(() => ({
    title: branding.value?.name ?? 'nasq',
    style: branding.value ? [{ innerHTML: `:root{--primary:${branding.value.primary_color}}` }] : [],
  }))
  return { branding }
}
