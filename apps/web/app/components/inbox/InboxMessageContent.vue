<script setup lang="ts">
import type { InboxMessage } from '@webvue/contracts'
import InboxCommerceMessage from '@/components/inbox/InboxCommerceMessage.vue'
import InboxFlowBubble from '@/components/inbox/InboxFlowBubble.vue'
import InboxFlowSubmissionCard from '@/components/inbox/InboxFlowSubmissionCard.vue'
import { inboxFileSize } from '@/composables/inbox/inboxAttachments'
import { locationMapUrl } from '@/composables/inbox/inboxLocation'

// What one message carries, by kind: inline image, sticker, video and audio players, document rows, a location card with
// its map link, shared contacts as text, an interactive message as the card the customer saw, and the option a customer
// chose. Text and captions come last.
const props = defineProps<{ message: InboxMessage; conversationId?: number; channelId?: number; windowOpen?: boolean }>()
const { t } = useI18n()
// A template's header file is a media of its own family, whatever the message kind says.
const mediaKind = (mimetype: string) => {
  const family = mimetype.split('/')[0]
  return family === 'image' || family === 'video' ? family : 'document'
}
const kindOf = (attachment: { mimetype: string }) => props.message.kind === 'template' ? mediaKind(attachment.mimetype) : props.message.kind
const attachmentUrl = (id: number) => `/api/v1/inbox/messages/${props.message.id}/attachments/${id}/download`
// The option a customer chose already is the body of its reply; show it once, as the highlighted choice.
// A product message or a cart is drawn by its commerce card, which carries its own texts; an inquiry keeps the customer's words.
const showBody = computed(() => !!props.message.body && !props.message.interactive && !props.message.flow_response && (props.message.commerce === null || props.message.commerce.type === 'inquiry') && props.message.body !== props.message.selected_option?.title)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <template v-for="attachment in props.message.attachments" :key="attachment.id">
      <a v-if="kindOf(attachment) === 'image'" :href="attachmentUrl(attachment.id)" target="_blank" rel="noopener" class="block" :aria-label="t('inbox.thread.openImage', { name: attachment.name })">
        <img :src="attachmentUrl(attachment.id)" :alt="attachment.name" loading="lazy" class="max-h-64 max-w-full rounded-control object-cover" data-testid="inbox-image">
      </a>
      <img v-else-if="props.message.kind === 'sticker'" :src="attachmentUrl(attachment.id)" :alt="t('inbox.thread.sticker')" loading="lazy" class="size-28 object-contain" data-testid="inbox-sticker">
      <video v-else-if="kindOf(attachment) === 'video'" :src="attachmentUrl(attachment.id)" controls preload="metadata" class="max-h-64 max-w-full rounded-control" :aria-label="attachment.name" data-testid="inbox-video" />
      <audio v-else-if="props.message.kind === 'audio'" :src="attachmentUrl(attachment.id)" controls preload="metadata" class="w-full min-w-52" :aria-label="attachment.name" data-testid="inbox-audio" />
      <a
        v-else
        :href="attachmentUrl(attachment.id)"
        :download="attachment.name"
        class="inline-flex min-h-8 items-center gap-2 rounded-control bg-default px-2 py-1 text-sm ring ring-default hover:bg-elevated"
      >
        <UIcon name="i-lucide-file-text" class="size-4 shrink-0" aria-hidden="true" />
        <bdi class="min-w-0 truncate">{{ attachment.name }}</bdi>
        <span class="shrink-0 text-xs text-muted">{{ inboxFileSize(attachment.size) }}</span>
      </a>
    </template>

    <SharedSubCard v-if="props.message.location" class="flex flex-col gap-1" data-testid="inbox-location-card">
      <p class="flex items-center gap-1.5 font-medium"><UIcon name="i-lucide-map-pin" class="size-4 shrink-0 text-primary" aria-hidden="true" />{{ props.message.location.name || t('inbox.thread.location') }}</p>
      <p v-if="props.message.location.address" class="text-sm text-muted">{{ props.message.location.address }}</p>
      <p class="text-xs text-muted"><bdi dir="ltr">{{ props.message.location.latitude }}, {{ props.message.location.longitude }}</bdi></p>
      <a :href="locationMapUrl(props.message.location)" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-sm text-brand-link underline">
        <UIcon name="i-lucide-external-link" class="size-3.5" aria-hidden="true" />{{ t('inbox.thread.openMap') }}
      </a>
    </SharedSubCard>

    <SharedSubCard v-if="props.message.interactive?.type === 'flow'" data-testid="inbox-interactive-card">
      <InboxFlowBubble :message="props.message.interactive" />
    </SharedSubCard>
    <SharedSubCard v-else-if="props.message.interactive" class="flex flex-col gap-1.5" data-testid="inbox-interactive-card">
      <p v-if="props.message.interactive.header" class="font-semibold">{{ props.message.interactive.header }}</p>
      <p class="whitespace-pre-wrap">{{ props.message.interactive.body }}</p>
      <p v-if="props.message.interactive.footer" class="text-xs text-muted">{{ props.message.interactive.footer }}</p>
      <ul v-if="props.message.interactive.type === 'buttons'" class="flex flex-wrap gap-1.5" :aria-label="t('inbox.thread.buttons')">
        <li v-for="button in props.message.interactive.buttons" :key="button.id" class="rounded-full px-3 py-1 text-sm text-primary ring ring-default">{{ button.title }}</li>
      </ul>
      <template v-else-if="props.message.interactive.type === 'list'">
        <p class="inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-sm text-primary ring ring-default"><UIcon name="i-lucide-list" class="size-4" aria-hidden="true" />{{ props.message.interactive.button }}</p>
        <section v-for="(section, index) in props.message.interactive.sections" :key="index" class="text-sm">
          <h4 v-if="section.title" class="text-xs font-medium text-muted">{{ section.title }}</h4>
          <ul class="mt-0.5 flex flex-col gap-0.5">
            <li v-for="row in section.rows" :key="row.id">{{ row.title }}<span v-if="row.description" class="text-xs text-muted"> · {{ row.description }}</span></li>
          </ul>
        </section>
      </template>
      <a v-else :href="props.message.interactive.url" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-sm text-primary ring ring-default">
        <UIcon name="i-lucide-external-link" class="size-4" aria-hidden="true" />{{ props.message.interactive.display_text }}
      </a>
    </SharedSubCard>

    <SharedSubCard v-if="props.message.flow_response" data-testid="inbox-flow-response-card">
      <InboxFlowSubmissionCard :submission="props.message.flow_response" />
    </SharedSubCard>
    <InboxCommerceMessage v-if="props.message.commerce" :message="props.message" :conversation-id="props.conversationId" :channel-id="props.channelId" :window-open="props.windowOpen" />

    <p v-if="props.message.selected_option" class="inline-flex items-center gap-1.5 self-start rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary" data-testid="inbox-selected-option">
      <UIcon name="i-lucide-circle-check" class="size-4" aria-hidden="true" />{{ t('inbox.thread.selected', { title: props.message.selected_option.title }) }}
    </p>
    <p v-if="props.message.template?.header_text" dir="auto" class="font-semibold" data-testid="inbox-template-header">{{ props.message.template.header_text }}</p>
    <p v-if="showBody" dir="auto" class="whitespace-pre-wrap">{{ props.message.body }}</p>
    <p v-else-if="props.message.kind === 'unsupported' && !props.message.body" class="text-muted">{{ t('inbox.thread.unsupported') }}</p>
    <p v-if="props.message.template?.footer" dir="auto" class="text-xs text-muted" data-testid="inbox-template-footer">{{ props.message.template.footer }}</p>
    <ul v-if="props.message.template?.buttons.length" class="flex flex-wrap gap-1.5" :aria-label="t('inbox.thread.buttons')" data-testid="inbox-template-buttons">
      <li v-for="(button, index) in props.message.template.buttons" :key="index" class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-primary ring ring-default"><UIcon v-if="button.type === 'flow'" name="i-lucide-file-pen-line" class="size-4" aria-hidden="true" />{{ button.text }}</li>
    </ul>
  </div>
</template>
