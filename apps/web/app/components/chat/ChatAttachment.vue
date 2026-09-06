<script setup lang="ts">
import type { ChatAttachment } from '@nasq/contracts'

const props = defineProps<{ attachment: ChatAttachment }>()
const { t } = useI18n()
</script>

<template>
  <a
    :href="props.attachment.url"
    class="inline-flex min-h-8 items-center gap-2 rounded-lg border px-2 py-1 text-sm text-start hover:bg-muted"
    :download="props.attachment.name"
  >
    <span class="truncate">{{ props.attachment.name }}</span>
    <span class="text-xs text-muted-foreground">{{ t('chat.download') }}</span>
  </a>
</template>
