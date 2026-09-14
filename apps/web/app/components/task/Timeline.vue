<script setup lang="ts">
import type { TimelineEntry } from '@nasq/contracts'
import { formatTimelineChange } from '@/utils/taskTimeline'

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
  return formatTimelineChange(change, locale.value, t)
}
</script>

<template>
  <ol v-if="entries.length" class="grid">
    <li v-for="entry in entries" :key="entry.id" class="task-activity-item relative flex gap-2 pb-4">
      <UAvatar :text="entry.author ? initials(entry.author.name) : '?'" class="z-10 size-7 shrink-0 text-xs ring ring-default" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span class="text-xs font-semibold text-highlighted">{{ entry.author?.name ?? (entry.kind === 'comment' ? t('tasks.activity.comment') : t('tasks.activity.system')) }}</span>
          <span class="text-xs text-muted">{{ relativeTime(entry.at) }}</span>
        </div>
        <SharedRichText v-if="entry.kind === 'comment'" :html="entry.body_html" size="sm" class="mt-1" />
        <ul v-else class="mt-1 space-y-0.5 whitespace-pre-wrap text-xs leading-relaxed text-muted">
          <li v-for="(change, i) in entry.changes ?? []" :key="i">{{ changeMessage(change) }}</li>
        </ul>
      </div>
    </li>
  </ol>
  <p v-else class="py-2 text-sm text-muted">{{ t('tasks.activity.empty') }}</p>
</template>

<style scoped>
/* The connector between avatars is a pseudo-element; utilities cannot draw it
   without a stack of arbitrary `after:` values. */
.task-activity-item:not(:last-child)::after {
  position: absolute;
  inset-block: 1.75rem 0;
  inset-inline-start: 0.8125rem;
  width: 1px;
  background: var(--ui-border);
  content: '';
}
</style>
