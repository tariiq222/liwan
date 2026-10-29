<script setup lang="ts">
import type { TemplatePreviewParts } from '@/composables/inbox/inboxTemplate'

// The template as the customer will see it: a WhatsApp-like bubble with the header, body, footer and buttons. Its
// direction follows the template's language, not the page, because that is how the customer's phone draws it.
const props = defineProps<{ parts: TemplatePreviewParts }>()
const { t } = useI18n()
const MEDIA_ICON = { image: 'i-lucide-image', video: 'i-lucide-video', document: 'i-lucide-file-text' } as const
const BUTTON_ICON = { quick_reply: 'i-lucide-reply', url: 'i-lucide-external-link', phone_number: 'i-lucide-phone', copy_code: 'i-lucide-copy' } as const
</script>

<template>
  <div class="rounded-card bg-elevated/60 p-3" data-testid="inbox-template-preview">
    <div :dir="props.parts.direction" class="mx-auto flex max-w-xs flex-col gap-1.5">
      <div class="flex flex-col gap-1.5 rounded-control bg-default p-2.5 text-sm text-start shadow-xs ring ring-default">
        <p v-if="props.parts.header?.kind === 'text'" dir="auto" class="font-semibold break-words" data-testid="inbox-template-preview-header">{{ props.parts.header.text }}</p>
        <div v-else-if="props.parts.header?.kind === 'media'" class="flex h-24 flex-col items-center justify-center gap-1 rounded-control bg-elevated text-muted" data-testid="inbox-template-preview-media">
          <UIcon :name="MEDIA_ICON[props.parts.header.media]" class="size-7" aria-hidden="true" />
          <span class="max-w-full truncate px-2 text-xs"><bdi>{{ props.parts.header.name ?? t(`inbox.templates.header.${props.parts.header.media}`) }}</bdi></span>
        </div>
        <div v-else-if="props.parts.header?.kind === 'location'" class="flex h-16 items-center justify-center gap-1.5 rounded-control bg-elevated text-muted" data-testid="inbox-template-preview-location">
          <UIcon name="i-lucide-map-pin" class="size-5" aria-hidden="true" /><span class="text-xs">{{ t('inbox.templates.header.location') }}</span>
        </div>
        <p dir="auto" class="whitespace-pre-wrap break-words" data-testid="inbox-template-preview-body">{{ props.parts.body || t('inbox.templates.preview.emptyBody') }}</p>
        <p v-if="props.parts.footer" dir="auto" class="text-xs text-muted break-words" data-testid="inbox-template-preview-footer">{{ props.parts.footer }}</p>
      </div>
      <ul v-if="props.parts.buttons.length" class="flex flex-col gap-1" :aria-label="t('inbox.thread.buttons')">
        <li
          v-for="(button, index) in props.parts.buttons"
          :key="index"
          class="flex items-center justify-center gap-1.5 rounded-control bg-default px-3 py-1.5 text-sm font-medium text-primary shadow-xs ring ring-default"
          data-testid="inbox-template-preview-button"
        >
          <UIcon :name="BUTTON_ICON[button.type]" class="size-4" aria-hidden="true" /><span dir="auto" class="min-w-0 truncate">{{ button.text || t('inbox.templates.preview.emptyButton') }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
