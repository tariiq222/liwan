<script setup lang="ts">
type MeetingVersion = {
  id: number
  number: number
  captured_at: string
  actor: { id: number; name: string } | null
  snapshot: Record<string, unknown>
}

const props = withDefaults(defineProps<{
  versions: MeetingVersion[]
  loading?: boolean
  error?: unknown
  total?: number
  page?: number
  pageSize?: number
  selectedId?: number | null
}>(), { loading: false, total: 0, page: 1, pageSize: 25, selectedId: null })
const emit = defineEmits<{ retry: []; page: [page: number]; select: [version: MeetingVersion] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const pages = computed(() => Math.max(1, Math.ceil((props.total ?? 0) / props.pageSize)))
const errorText = computed(() => props.error instanceof Error ? props.error.message : t('errors.generic'))

function capturedAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short', calendar: 'gregory' }).format(date)
}
</script>

<template>
  <section class="nasq-panel grid gap-3" data-testid="meeting-version-list">
    <div class="nasq-panel-header"><h2>{{ t('meetingMinutesForm.versions') }}</h2></div>
    <div class="nasq-panel-body grid gap-3">
      <div v-if="loading" class="grid gap-2" aria-busy="true"><Skeleton v-for="row in 4" :key="row" class="h-12 w-full" /></div>
      <div v-else-if="error" class="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive" role="alert"><span>{{ errorText }}</span><Button type="button" variant="outline" size="sm" :disabled="!hydrated" @click="emit('retry')">{{ t('meetingMinutesForm.retry') }}</Button></div>
      <div v-else-if="!versions.length" class="text-sm text-muted-foreground">{{ t('meetingMinutesForm.noVersions') }}</div>
      <ol v-else class="grid gap-2">
        <li v-for="version in versions" :key="version.id">
          <button type="button" class="grid w-full min-w-0 gap-1 rounded-lg border p-3 text-start transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :class="{ 'border-brand-link bg-muted/30': selectedId === version.id }" :disabled="!hydrated" @click="emit('select', version)">
            <span class="font-medium">{{ t('meetingMinutesForm.versionNumber', { number: version.number }) }}</span>
            <span class="text-xs text-muted-foreground">{{ capturedAt(version.captured_at) }} · {{ version.actor?.name || t('meetingMinutesForm.systemActor') }}</span>
          </button>
        </li>
      </ol>
      <nav v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground" :aria-label="t('meetingMinutesForm.pagination')">
        <Button type="button" variant="ghost" :disabled="!hydrated || loading || page <= 1" @click="emit('page', page - 1)">{{ t('meetingMinutesForm.previous') }}</Button>
        <span>{{ t('meetingMinutesForm.pageOf', { page, pages }) }}</span>
        <Button type="button" variant="ghost" :disabled="!hydrated || loading || page >= pages" @click="emit('page', page + 1)">{{ t('meetingMinutesForm.next') }}</Button>
      </nav>
    </div>
  </section>
</template>
