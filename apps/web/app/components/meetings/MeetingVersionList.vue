<script setup lang="ts">
import { formatNasqDateTime } from '@/composables/calendarDate'

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
  return formatNasqDateTime(value, locale.value)
}
</script>

<template>
  <UCard data-testid="meeting-version-list">
    <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingMinutesForm.versions') }}</h2></template>
    <div class="grid gap-3">
      <div v-if="loading" class="grid gap-2" aria-busy="true"><USkeleton v-for="row in 4" :key="row" class="h-12 w-full" /></div>
      <div v-else-if="error" class="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive" role="alert"><span>{{ errorText }}</span><UButton type="button" color="secondary" variant="outline" size="sm" :disabled="!hydrated" :label="t('meetingMinutesForm.retry')" @click="emit('retry')" /></div>
      <div v-else-if="!versions.length" class="text-sm text-muted-foreground">{{ t('meetingMinutesForm.noVersions') }}</div>
      <ol v-else class="grid gap-2">
        <li v-for="version in versions" :key="version.id">
          <UButton type="button" color="neutral" variant="ghost" class="nasq-ui-record-surface grid w-full min-w-0 justify-items-start gap-1 p-3 text-start transition-colors hover:bg-muted/30" :class="{ 'nasq-ui-selected border-brand-link bg-muted/30': selectedId === version.id }" :data-selected="selectedId === version.id ? 'true' : undefined" :disabled="!hydrated" @click="emit('select', version)">
            <span class="font-medium">{{ t('meetingMinutesForm.versionNumber', { number: version.number }) }}</span>
            <span class="text-xs text-muted-foreground">{{ capturedAt(version.captured_at) }} · {{ version.actor?.name || t('meetingMinutesForm.systemActor') }}</span>
          </UButton>
        </li>
      </ol>
      <nav v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground" :aria-label="t('meetingMinutesForm.pagination')">
        <UButton type="button" color="neutral" variant="ghost" :disabled="!hydrated || loading || page <= 1" :label="t('meetingMinutesForm.previous')" @click="emit('page', page - 1)" />
        <span>{{ t('meetingMinutesForm.pageOf', { page, pages }) }}</span>
        <UButton type="button" color="neutral" variant="ghost" :disabled="!hydrated || loading || page >= pages" :label="t('meetingMinutesForm.next')" @click="emit('page', page + 1)" />
      </nav>
    </div>
  </UCard>
</template>
