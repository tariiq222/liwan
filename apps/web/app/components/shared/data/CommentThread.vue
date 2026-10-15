<script setup lang="ts">
import { formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'

export interface SharedComment { id: number; authorName: string | null; createdAt: string; body: string }

// A plain-text comment thread, oldest first as the app orders it: author, time and the body shown
// as text. It runs no request; the compose form is the `composer` slot (`SharedCommentComposer`).
const props = defineProps<{
  comments: SharedComment[]
  emptyText: string
  unknownAuthor: string
  loading?: boolean
  error?: unknown
}>()
defineEmits<{ retry: [] }>()

const { locale } = useI18n()
</script>

<template>
  <div class="space-y-3">
    <SharedPageState :loading="loading" :error="error" :empty="!props.comments.length" :empty-text="emptyText" @retry="$emit('retry')">
      <ul class="divide-y divide-default">
        <li v-for="comment in props.comments" :key="comment.id" class="grid gap-1 py-3">
          <div class="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
            <span class="font-medium text-default">{{ comment.authorName ?? unknownAuthor }}</span>
            <time :datetime="comment.createdAt">{{ formatNasqDateTime(comment.createdAt, locale) }}</time>
          </div>
          <p class="whitespace-pre-wrap break-words text-sm text-default">{{ comment.body }}</p>
        </li>
      </ul>
    </SharedPageState>
    <div v-if="$slots.composer" class="border-t border-default pt-3"><slot name="composer" /></div>
  </div>
</template>
