import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  AiAgentSettingsSchema, AiCompanyNoteListSchema, AiKnowledgeRebuildSchema, AiMonitoringSchema, AiSettingsSchema, AiTenantConfigSchema,
  type AiAgentPatch, type AiAgentSettings, type AiCompanyNoteList, type AiConsentSign, type AiKeyPut, type AiSettings, type AiSettingsPatch, type AiTenantConfig,
} from '@liwan/contracts'

// The tenant's AI policy lives in two places: Odoo holds the provider mode, the consent and the limits
// (`/api/v1/ai/settings`); the AI service holds the tenant's own key and the run retention (`/api/ai/config`, reached
// through this server, which checks `ai.settings.manage` first). Both are tenant-wide, so one cache entry each.
export const aiSettingsKeys = {
  settings: ['ai', 'settings'] as const,
  config: ['ai', 'config'] as const,
  monitoring: ['ai', 'monitoring'] as const,
  agents: ['ai', 'agents'] as const,
  companyMemory: ['ai', 'company-memory'] as const,
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

/** The agents of the tenant's enabled applications and how the administrator narrowed each one. */
export function useAiAgentSettings(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: aiSettingsKeys.agents,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/ai/agents', { schema: AiAgentSettingsSchema }),
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

/** Clears the knowledge index cursors and queues a full rebuild; the index refills in the background. */
export function useRebuildAiKnowledge() {
  const { $api } = useApi()
  return useMutation({ mutationFn: () => $api('/api/v1/ai/knowledge/rebuild', { method: 'POST', body: {}, schema: AiKnowledgeRebuildSchema }) })
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

export function useSaveAiLeaverRetention() {
  const { $api } = useApi()
  return useReplacing<number, AiTenantConfig>(aiSettingsKeys.config, days => $api('/api/ai/config/leaver-retention', { method: 'PUT', body: { leaver_retention_days: days }, schema: AiTenantConfigSchema }))
}

export function useSaveAiKey() {
  const { $api } = useApi()
  return useReplacing<AiKeyPut, AiTenantConfig>(aiSettingsKeys.config, body => $api('/api/ai/config/key', { method: 'PUT', body, schema: AiTenantConfigSchema }))
}

export function useRemoveAiKey() {
  const { $api } = useApi()
  return useReplacing<void, AiTenantConfig>(aiSettingsKeys.config, () => $api('/api/ai/config/key', { method: 'DELETE', body: {}, schema: AiTenantConfigSchema }))
}

export function useSaveAiAgent() {
  const { $api } = useApi()
  return useReplacing<{ key: string; patch: AiAgentPatch }, AiAgentSettings>(
    aiSettingsKeys.agents,
    ({ key, patch }) => $api(`/api/v1/ai/agents/${encodeURIComponent(key)}`, { method: 'PATCH', body: patch, schema: AiAgentSettingsSchema }),
  )
}

/** The current company's notes (proposed and approved), for a settings manager of that company. */
export function useAiCompanyMemory(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: aiSettingsKeys.companyMemory,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/ai/company-memory', { schema: AiCompanyNoteListSchema }),
    retry: false,
  })
}

export function useDecideAiCompanyNote() {
  const { $api } = useApi()
  return useReplacing<{ id: number; approve: boolean }, AiCompanyNoteList>(aiSettingsKeys.companyMemory, ({ id, approve }) => approve
    ? $api(`/api/ai/company-memory/${id}/approve`, { method: 'POST', body: {}, schema: AiCompanyNoteListSchema })
    : $api(`/api/ai/company-memory/${id}`, { method: 'DELETE', body: {}, schema: AiCompanyNoteListSchema }))
}
