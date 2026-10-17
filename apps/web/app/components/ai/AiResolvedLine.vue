<script setup lang="ts">
// The settled form of an AI decision block (a confirmation or a draft): what was asked and how it ended.
const props = defineProps<{
  summary: string
  state: 'approved' | 'rejected'
}>()
const { t } = useI18n()
</script>

<template>
  <p :data-state="props.state" class="flex items-center gap-2 text-sm text-muted">
    <UIcon :name="props.state === 'approved' ? 'i-lucide-check' : 'i-lucide-x'" aria-hidden="true" class="size-4 shrink-0" />
    <span class="min-w-0 break-words">{{ props.summary }} — {{ t(props.state === 'approved' ? 'ai.confirm.approved' : 'ai.confirm.rejected') }}</span>
  </p>
</template>
