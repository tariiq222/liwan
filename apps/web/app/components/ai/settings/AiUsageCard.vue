<script setup lang="ts">
import { AI_CORE_AGENT, type AiAgentSettings, type AiMonitoring, type AiSettings } from '@liwan/contracts'

// This month's AI use against the package limits, and who used it for what: counts of messages, tokens and tool actions
// only. Administrators never see conversation text; employees are told so on the assistant page.
const props = defineProps<{ settings: AiSettings; monitoring: AiMonitoring | undefined; agents?: AiAgentSettings }>()
const { t, n, locale } = useI18n()
// An agent is named as its settings name it; the coordinator, and an agent of an application since switched off, by key.
const agentLabel = (key: string) => {
  if (key === AI_CORE_AGENT) return t('ai.settings.usage.coordinator')
  const agent = props.agents?.items.find(item => item.key === key)
  return agent ? (locale.value === 'en' ? agent.name.en : agent.name.ar) : key
}

const usage = computed(() => props.settings.usage)
const percent = (used: number, limit: number | null) => (limit ? (used / limit) * 100 : null)
const tone = (value: number | null) => (value !== null && value >= 80 ? 'warning' : 'primary')
const meters = computed(() => [
  { id: 'messages', label: t('ai.settings.usage.messages'), used: usage.value.messages_used, limit: usage.value.messages_limit },
  { id: 'tokens', label: t('ai.settings.usage.tokens'), used: usage.value.tokens_used, limit: usage.value.tokens_limit },
].map(meter => ({ ...meter, percent: percent(meter.used, meter.limit) })))
const limitText = (limit: number | null) => (limit === null ? t('ai.settings.usage.unlimited') : n(limit))
const columns = computed(() => [
  { accessorKey: 'name', header: t('ai.settings.usage.user') },
  { accessorKey: 'messages', header: t('ai.settings.usage.messages') },
  { accessorKey: 'tokens', header: t('ai.settings.usage.tokens') },
  { accessorKey: 'tool_calls', header: t('ai.settings.usage.toolCalls') },
])
const rows = computed(() => (props.monitoring?.users.items ?? []).map(item => ({ name: item.user.name, messages: n(item.messages), tokens: n(item.tokens), tool_calls: n(item.tool_calls) })))
</script>

<template>
  <SharedRecordSection id="usage" variant="panel" class="liwan-settings-anchor" :title="t('ai.settings.usage.title')" :description="t('ai.settings.usage.hint', { month: usage.month })" data-testid="ai-settings-usage">
    <div class="grid gap-(--liwan-gap-card)">
      <div class="grid gap-(--liwan-gap-card) sm:grid-cols-2">
        <div v-for="meter in meters" :key="meter.id" class="grid gap-2" :data-testid="`ai-usage-${meter.id}`">
          <SharedMetricTile :label="meter.label" :value="n(meter.used)" value-dir="ltr" :hint="t('ai.settings.usage.ofLimit', { limit: limitText(meter.limit) })" />
          <SharedProgress v-if="meter.percent !== null" :value="meter.percent" :tone="tone(meter.percent)" :label="meter.label" />
        </div>
      </div>
      <p v-if="usage.output_tokens_per_run !== null" class="text-sm text-muted">{{ t('ai.settings.usage.perRun', { limit: n(usage.output_tokens_per_run) }) }}</p>
      <UTable v-if="rows.length" :data="rows" :columns="columns" class="w-full" data-testid="ai-usage-users" />
      <p v-else class="text-sm text-muted">{{ t('ai.settings.usage.empty') }}</p>
      <div v-if="monitoring?.agents.items.length" class="grid gap-2" data-testid="ai-usage-agents">
        <h3 class="text-sm font-medium">{{ t('ai.settings.usage.byAgent') }}</h3>
        <ul class="grid gap-1 text-sm">
          <li v-for="agent in monitoring.agents.items" :key="agent.agent" class="flex justify-between gap-4">
            <span>{{ agentLabel(agent.agent) }}</span><span class="tabular-nums">{{ n(agent.calls) }}</span>
          </li>
        </ul>
      </div>
      <div v-if="monitoring?.tools.items.length" class="grid gap-2" data-testid="ai-usage-tools">
        <h3 class="text-sm font-medium">{{ t('ai.settings.usage.topTools') }}</h3>
        <ul class="grid gap-1 text-sm">
          <li v-for="tool in monitoring.tools.items" :key="tool.tool_name" class="flex justify-between gap-4">
            <span dir="ltr">{{ tool.tool_name }}</span><span class="tabular-nums">{{ n(tool.calls) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </SharedRecordSection>
</template>
