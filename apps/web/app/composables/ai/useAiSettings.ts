import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  AiMonitoringSchema, AiSettingsSchema, AiTenantConfigSchema,
  type AiConsentSign, type AiKeyPut, type AiSettings, type AiSettingsPatch, type AiTenantConfig,
} from '@liwan/contracts'

// The tenant's AI policy lives in two places: Odoo holds the provider mode, the consent and the limits
// (`/api/v1/ai/settings`); the AI service holds the tenant's own key and the run retention (`/api/ai/config`, reached
// through this server, which checks `ai.settings.manage` first). Both are tenant-wide, so one cache entry each.
export const aiSettingsKeys = {
  settings: ['ai', 'settings'] as const,
  config: ['ai', 'config'] as const,
  monitoring: ['ai', 'monitoring'] as const,
}

export function useAiSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: aiSettingsKeys.settings,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/ai/settings', { schema: AiSettingsSchema }),
    retry: false,
  })
}

export function useAiTenantConfig(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: aiSettingsKeys.config,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/ai/config', { schema: AiTenantConfigSchema }),
    retry: false,
  })
}

export function useAiMonitoring(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: aiSettingsKeys.monitoring,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/ai/monitoring', { schema: AiMonitoringSchema }),
    retry: false,
  })
}

/** Every write answers the whole new state, which replaces the cache outright (an older read in flight is cancelled first). */
function useReplacing<Body, Result>(key: readonly unknown[], send: (body: Body) => Promise<Result>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: Body) => {
      const saved = await send(body)
      await qc.cancelQueries({ queryKey: key, exact: true })
      qc.setQueryData(key, saved)
      return saved
    },
  })
}

export function useSaveAiSettings() {
  const { $api } = useApi()
  return useReplacing<AiSettingsPatch, AiSettings>(aiSettingsKeys.settings, body => $api('/api/v1/ai/settings', { method: 'PATCH', body, schema: AiSettingsSchema }))
}

export function useSignAiConsent() {
  const { $api } = useApi()
  return useReplacing<AiConsentSign, AiSettings>(aiSettingsKeys.settings, body => $api('/api/v1/ai/consent', { method: 'POST', body, schema: AiSettingsSchema }))
}

export function useRevokeAiConsent() {
  const { $api } = useApi()
  return useReplacing<void, AiSettings>(aiSettingsKeys.settings, () => $api('/api/v1/ai/consent/revoke', { method: 'POST', body: {}, schema: AiSettingsSchema }))
}

export function useSaveAiRetention() {
  const { $api } = useApi()
  return useReplacing<number, AiTenantConfig>(aiSettingsKeys.config, days => $api('/api/ai/config/retention', { method: 'PUT', body: { retention_days: days }, schema: AiTenantConfigSchema }))
}

export function useSaveAiKey() {
  const { $api } = useApi()
  return useReplacing<AiKeyPut, AiTenantConfig>(aiSettingsKeys.config, body => $api('/api/ai/config/key', { method: 'PUT', body, schema: AiTenantConfigSchema }))
}

export function useRemoveAiKey() {
  const { $api } = useApi()
  return useReplacing<void, AiTenantConfig>(aiSettingsKeys.config, () => $api('/api/ai/config/key', { method: 'DELETE', body: {}, schema: AiTenantConfigSchema }))
}
