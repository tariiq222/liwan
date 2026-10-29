<script setup lang="ts">
import type { InboxBusinessVertical } from '@webvue/contracts'

// A WhatsApp-style business card: the picture, the display name with its business badge, the about text and the contact
// rows, as a customer sees them. It is a rough preview of the draft, not Meta's exact rendering. Logical classes keep it
// right-to-left aware.
export interface InboxProfilePreviewValue {
  about: string
  address: string
  description: string
  email: string
  websites: readonly string[]
  vertical: InboxBusinessVertical | ''
  pictureUrl: string | null
}
const props = defineProps<{ name: string; profile: InboxProfilePreviewValue }>()
const { t } = useI18n()
const rows = computed(() => [
  { id: 'description', icon: 'i-lucide-text', text: props.profile.description },
  { id: 'address', icon: 'i-lucide-map-pin', text: props.profile.address },
  { id: 'email', icon: 'i-lucide-mail', text: props.profile.email, ltr: true },
  ...props.profile.websites.filter(Boolean).map((site, index) => ({ id: `website-${index}`, icon: 'i-lucide-globe', text: site, ltr: true })),
].filter(row => row.text.trim()))
</script>

<template>
  <section class="overflow-hidden rounded-card bg-default ring ring-default" data-testid="inbox-profile-preview" :aria-label="t('inbox.profile.preview.title')">
    <div class="flex flex-col items-center gap-2 bg-elevated/40 px-4 py-6 text-center">
      <UAvatar :src="profile.pictureUrl ?? undefined" icon="i-lucide-store" size="3xl" :alt="t('inbox.profile.picture.aria')" data-testid="inbox-profile-preview-picture" />
      <h3 class="max-w-full truncate text-base font-semibold text-highlighted"><bdi>{{ name }}</bdi></h3>
      <span class="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
        <UIcon name="i-lucide-badge-check" class="size-3.5" aria-hidden="true" />{{ t('inbox.profile.preview.business') }}
      </span>
      <span v-if="profile.vertical" class="text-xs text-muted">{{ t(`inbox.profile.vertical.${profile.vertical}`) }}</span>
    </div>
    <div class="flex flex-col gap-3 p-4">
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-muted">{{ t('inbox.profile.preview.about') }}</span>
        <p class="whitespace-pre-line break-words text-sm text-default" data-testid="inbox-profile-preview-about" dir="auto">{{ profile.about.trim() || t('inbox.profile.preview.noAbout') }}</p>
      </div>
      <ul v-if="rows.length" class="flex flex-col gap-2 border-t border-default pt-3">
        <li v-for="row in rows" :key="row.id" class="flex items-start gap-2 text-sm">
          <UIcon :name="row.icon" class="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
          <span class="min-w-0 break-words text-default" :dir="row.ltr ? 'ltr' : 'auto'">{{ row.text }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
