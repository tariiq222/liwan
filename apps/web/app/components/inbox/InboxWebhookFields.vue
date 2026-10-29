<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { WEBHOOK_FIELDS } from '@/composables/inbox/useInboxChannelHealth'

// The webhook fields the Meta app must subscribe to, each with a copy button: the checklist an admin walks through in Meta.
const { t } = useI18n()
const clipboard = useClipboard({ copiedDuring: 2000 })
const copied = ref<string | null>(null)
async function copy(field: string) {
  await clipboard.copy(field)
  copied.value = field
  setTimeout(() => { if (copied.value === field) copied.value = null }, 2000)
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('inbox.health.webhook.title')" :description="t('inbox.health.webhook.description')" data-testid="inbox-health-webhook">
    <ul class="flex flex-col gap-2">
      <li v-for="field in WEBHOOK_FIELDS" :key="field" class="flex items-center justify-between gap-3">
        <code class="min-w-0 truncate text-sm" dir="ltr">{{ field }}</code>
        <UButton
          type="button" color="neutral" variant="ghost" size="sm" :icon="copied === field ? 'i-lucide-check' : 'i-lucide-copy'"
          :label="copied === field ? t('inbox.health.webhook.copied') : t('inbox.health.webhook.copy')" :aria-label="t('inbox.health.webhook.copyAria', { field })"
          :data-testid="`inbox-health-webhook-${field}`" @click="copy(field)"
        />
      </li>
    </ul>
  </SharedRecordSection>
</template>
