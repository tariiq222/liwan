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
  <ol v-if="entries.length" class="task-activity-list">
    <li v-for="entry in entries" :key="entry.id" class="task-activity-item">
      <div class="task-activity-marker" aria-hidden="true">
        <Avatar class="size-7">
          <AvatarFallback class="text-[10px]">{{ entry.author ? initials(entry.author.name) : '?' }}</AvatarFallback>
        </Avatar>
      </div>
      <div class="min-w-0">
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span class="task-activity-title">{{ entry.author?.name ?? (entry.kind === 'comment' ? t('tasks.activity.comment') : t('tasks.activity.system')) }}</span>
          <span class="task-activity-meta">{{ relativeTime(entry.at) }}</span>
        </div>
        <div
          v-if="entry.kind === 'comment'"
          class="task-activity-body prose prose-sm max-w-none break-words"
          v-html="sanitizeHtml(entry.body_html ?? '')"
        />
        <ul v-else class="task-activity-body space-y-0.5">
          <li v-for="(change, i) in entry.changes ?? []" :key="i">{{ changeMessage(change) }}</li>
        </ul>
      </div>
    </li>
  </ol>
  <p v-else class="py-2 text-xs text-muted-foreground">{{ t('tasks.activity.empty') }}</p>
</template>

<style scoped>
.task-activity-list {
  display: grid;
}

.task-activity-item {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 9px;
  padding-bottom: 16px;
}

.task-activity-item:not(:last-child)::after {
  position: absolute;
  inset-block: 28px 0;
  inset-inline-start: 13px;
  width: 1px;
  background: var(--border);
  content: '';
}

.task-activity-marker {
  z-index: 1;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--muted);
  color: var(--muted-foreground);
}

.task-activity-title {
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.55;
}

.task-activity-meta {
  color: var(--muted-foreground);
  font-size: 0.6875rem;
}

.task-activity-body {
  margin-top: 5px;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  line-height: 1.75;
  white-space: pre-wrap;
}
</style>
