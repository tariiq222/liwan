<script setup lang="ts">
import type { InboxFlowInteractive } from '@webvue/contracts'

// The message that opens a form, as the customer sees it: header, body, footer and the button that opens the form.
// `name` is the form's name when the caller knows it (the composer's picker); the thread only has the button text.
const props = defineProps<{ message: Pick<InboxFlowInteractive, 'header' | 'body' | 'footer' | 'cta'>; name?: string | null }>()
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="inbox-flow-bubble">
    <p v-if="props.message.header" dir="auto" class="font-semibold break-words">{{ props.message.header }}</p>
    <p dir="auto" class="whitespace-pre-wrap break-words">{{ props.message.body }}</p>
    <p v-if="props.message.footer" dir="auto" class="text-xs text-muted break-words">{{ props.message.footer }}</p>
    <p class="inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-sm text-primary ring ring-default" data-testid="inbox-flow-bubble-cta">
      <UIcon name="i-lucide-file-pen-line" class="size-4 shrink-0" aria-hidden="true" /><span dir="auto" class="min-w-0 break-words">{{ props.message.cta }}</span>
    </p>
    <p v-if="props.name" class="text-xs text-muted" data-testid="inbox-flow-bubble-name"><bdi>{{ props.name }}</bdi></p>
  </div>
</template>
