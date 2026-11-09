<script setup lang="ts">
import type { AiAgentSetting, AiAgentSettings, AiToolMode, RoleSummary } from '@liwan/contracts'
import { useSaveAiAgent } from '@/composables/ai/useAiSettings'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// One specialist agent as the administrator narrows it (spec 2026-11-04 §6.7): on or off, read only, limited to some
// roles, and each tool on, waiting for the user's approval, or off. None of it can give an employee more than their own
// permissions; the server enforces every choice. `roles` is null for a manager who cannot read the role catalog. A save
// carries the revision it was read at; another administrator's save first answers 409 and the card locks until reloaded.
const props = defineProps<{ agent: AiAgentSetting; roles: RoleSummary[] | null; reloadAgents: () => Promise<AiAgentSettings> }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveAgent } = useSaveAiAgent()

type Draft = { enabled: boolean; read_only: boolean; memory: boolean; role_ids: number[]; tools: Record<string, AiToolMode> }
const read = (agent: AiAgentSetting): Draft => ({
  enabled: agent.enabled, read_only: agent.read_only, memory: agent.memory, role_ids: [...agent.role_ids],
  tools: Object.fromEntries(agent.tools.map(tool => [tool.name, tool.mode])),
})
const current = (agents: AiAgentSettings) => agents.items.find(item => item.key === props.agent.key) ?? props.agent
const { draft, state, save, revert, reload } = useSettingsForm<AiAgentSetting, Draft>({
  source: () => props.agent,
  read,
  save: async (values, latest) => {
    // Roles are sent only when changed: a manager without the role catalog, or an agent kept on a role archived since,
    // still saves its other choices.
    const { role_ids: roleIds, ...rest } = values
    const rolesChanged = JSON.stringify([...roleIds].sort()) !== JSON.stringify([...props.agent.role_ids].sort())
    const changes = props.roles !== null && rolesChanged ? values : rest
    const saved = await saveAgent({ key: props.agent.key, patch: { ...changes, revision: latest.revision } })
    toast.add({ title: t('ai.settings.saved'), color: 'success' })
    return current(saved)
  },
  reload: async () => current(await props.reloadAgents()),
})
const locked = computed(() => !hydrated.value || state.value.saving || state.value.reloading)
const text = (value: { ar: string; en: string }) => (locale.value === 'en' ? value.en : value.ar)
const modes = computed(() => (['on', 'approval', 'off'] as const).map(value => ({ value, label: t(`ai.settings.agents.mode.${value}`) })))
const roleItems = computed(() => (props.roles ?? []).filter(role => role.assignable && role.active).map(role => ({ value: role.id, label: locale.value === 'en' ? (role.name.en ?? role.name.ar) : role.name.ar })))
// A read-only agent keeps its read tools only; its write and draft tools are shown as off.
const toolDisabled = (kind: string) => locked.value || !draft.value.enabled || (draft.value.read_only && kind !== 'read')
</script>

<template>
  <SharedSettingsCard :id="`agent-${agent.key}`" v-bind="state" :title="text(agent.name)" :description="text(agent.description)" :can-edit="true" :data-testid="`ai-agent-${agent.key}`" @save="save" @revert="revert" @reload="reload">
    <SharedSettingRow :label="t('ai.settings.agents.enabled')" :name="`${agent.key}-enabled`">
      <USwitch v-model="draft.enabled" :disabled="locked" :aria-label="t('ai.settings.agents.enabled')" />
    </SharedSettingRow>
    <SharedSettingRow :label="t('ai.settings.agents.readOnly')" :name="`${agent.key}-read-only`" :description="t('ai.settings.agents.readOnlyHint')">
      <USwitch v-model="draft.read_only" :disabled="locked || !draft.enabled" :aria-label="t('ai.settings.agents.readOnly')" />
    </SharedSettingRow>
    <UFormField v-if="!agent.memory_fixed" orientation="horizontal" :label="t('ai.settings.agents.memory')" :name="`${agent.key}-memory`" :description="t('ai.settings.agents.memoryHint')">
      <USwitch v-model="draft.memory" :disabled="locked || !draft.enabled" :aria-label="t('ai.settings.agents.memory')" />
    </UFormField>
    <UFormField v-if="roles !== null" orientation="horizontal" :label="t('ai.settings.agents.roles')" :name="`${agent.key}-roles`" :description="t('ai.settings.agents.rolesHint')">
      <USelectMenu v-model="draft.role_ids" multiple value-key="value" class="w-full" :items="roleItems" :disabled="locked || !draft.enabled" :placeholder="t('ai.settings.agents.allRoles')" :aria-label="t('ai.settings.agents.roles')" />
    </UFormField>
    <div class="grid gap-3" role="group" :aria-label="t('ai.settings.agents.tools')">
      <h3 class="text-sm font-medium">{{ t('ai.settings.agents.tools') }}</h3>
      <UFormField v-for="tool in agent.tools" :key="tool.name" orientation="horizontal" :label="text(tool.description)" :name="tool.name" :description="t(`ai.settings.agents.kind.${tool.kind}`)">
        <USelect v-model="draft.tools[tool.name]" class="w-full" :items="modes" :disabled="toolDisabled(tool.kind)" :aria-label="text(tool.description)" />
      </UFormField>
    </div>
  </SharedSettingsCard>
</template>
