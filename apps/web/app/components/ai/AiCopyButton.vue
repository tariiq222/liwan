<script setup lang="ts">
const props = defineProps<{ text: string }>()
const { t } = useI18n()
const toast = useToast()

async function copy() {
  try {
    await navigator.clipboard.writeText(props.text)
    toast.add({ title: t('ai.thread.copied') })
  } catch {
    toast.add({ title: t('ai.thread.copyFailed'), color: 'error' })
  }
}
</script>

<template>
  <UButton type="button" color="neutral" variant="ghost" size="xs" class="webvue-touch-target rounded-full" icon="i-lucide-copy" :label="t('ai.thread.copy')" data-testid="ai-copy" @click="copy" />
</template>
