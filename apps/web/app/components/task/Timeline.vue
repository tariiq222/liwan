<script setup lang="ts">
import type { TimelineEntry } from '@nasq/contracts'
import { sanitizeHtml } from '@/utils/sanitize'

const props = defineProps<{ entries: TimelineEntry[] }>()

const { t, locale } = useI18n()

// Recomputed lazily per render rather than kept live (no ticking clock in
// phase 1) — good enough for a feed that re-renders whenever new entries
// arrive or the panel is reopened.
const rtf = computed(() => new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }))

function relativeTime(at: string): string {
  const diffMs = new Date(at).getTime() - Date.now()
  const diffMin = Math.round(diffMs / 60_000)
  if (Math.abs(diffMin) < 60) return rtf.value.format(diffMin, 'minute')
  const diffHour = Math.round(diffMin / 60)
  if (Math.abs(diffHour) < 24) return rtf.value.format(diffHour, 'hour')
  const diffDay = Math.round(diffHour / 24)
  return rtf.value.format(diffDay, 'day')
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

function changeMessage(change: { field: string; label: string; old: unknown; new: unknown }): string {
  const hasNew = change.new !== null && change.new !== undefined && change.new !== ''
  const hasOld = change.old !== null && change.old !== undefined && change.old !== ''
  if (!hasNew) return t('tasks.activity.cleared', { field: change.label })
  if (!hasOld) return t('tasks.activity.set', { field: change.label, new: change.new })
  return t('tasks.activity.changed', { field: change.label, old: change.old, new: change.new })
}
</script>

<template>
  <ol v-if="entries.length" class="space-y-4">
    <li v-for="entry in entries" :key="entry.id" class="flex gap-3">
      <Avatar class="size-8 shrink-0">
        <AvatarFallback class="text-xs">{{ entry.author ? initials(entry.author.name) : '?' }}</AvatarFallback>
      </Avatar>
      <div class="min-w-0 flex-1 space-y-1">
        <div class="flex items-center gap-2 text-sm">
          <span class="font-medium">{{ entry.author?.name ?? (entry.kind === 'comment' ? t('tasks.activity.comment') : t('tasks.activity.system')) }}</span>
          <span class="text-xs text-muted-foreground">{{ relativeTime(entry.at) }}</span>
        </div>
        <div
          v-if="entry.kind === 'comment'"
          class="prose prose-sm max-w-none text-sm break-words"
          v-html="sanitizeHtml(entry.body_html ?? '')"
        />
        <ul v-else class="space-y-0.5 text-sm text-muted-foreground">
          <li v-for="(change, i) in entry.changes ?? []" :key="i">{{ changeMessage(change) }}</li>
        </ul>
      </div>
    </li>
  </ol>
  <p v-else class="text-sm text-muted-foreground">{{ t('tasks.activity.empty') }}</p>
</template>
