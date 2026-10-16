<script setup lang="ts">
const props = defineProps<{
  limit: 'max_tool_calls' | 'max_steps' | 'timeout' | 'messages_monthly'
  used?: number
  max?: number | null
}>()
const { t } = useI18n()
const text = computed(() => t(props.limit === 'messages_monthly' ? 'ai.limits.monthly' : props.limit === 'timeout' ? 'ai.limits.timeout' : 'ai.limits.run'))
</script>

<template>
  <UAlert role="alert" color="warning" variant="subtle" icon="i-lucide-gauge" :title="text" data-testid="ai-limit">
    <template v-if="props.used !== undefined && props.max != null" #description>
      <p>{{ t('ai.limits.used', { used: props.used, limit: props.max }) }}</p>
    </template>
  </UAlert>
</template>
