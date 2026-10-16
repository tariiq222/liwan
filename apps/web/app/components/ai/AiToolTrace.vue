<script setup lang="ts">
const props = defineProps<{
  summary: string
  state: 'running' | 'ok' | 'denied' | 'failed' | 'stalled'
  disabled?: boolean
}>()
// `stalled`: the read stopped before its result reached the assistant; the user may run it again.
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
const icon = computed(() => ({ running: 'i-lucide-loader-circle', ok: 'i-lucide-check', denied: 'i-lucide-lock', failed: 'i-lucide-circle-alert', stalled: 'i-lucide-circle-alert' })[props.state])
const textKey = computed(() => ({ denied: 'ai.tool.denied', failed: 'ai.tool.failed', stalled: 'ai.tool.stalled' })[props.state as 'denied'] ?? 'ai.tool.reading')
</script>

<template>
  <div :data-state="props.state" class="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="ai-tool-trace">
    <UIcon :name="icon" aria-hidden="true" class="size-3.5 shrink-0" :class="props.state === 'running' ? 'motion-safe:animate-spin' : ''" />
    <span class="min-w-0 break-words">{{ t(textKey, { summary: props.summary }) }}</span>
    <UButton v-if="props.state === 'stalled'" type="button" size="xs" color="neutral" variant="outline" :disabled="props.disabled" :label="t('ai.tool.retry')" data-testid="ai-tool-retry" @click="emit('retry')" />
  </div>
</template>
