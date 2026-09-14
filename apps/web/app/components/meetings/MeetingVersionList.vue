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
      <div v-if="loading" class="grid gap-2" role="status" aria-busy="true" :aria-label="t('app.loading')"><USkeleton v-for="row in 4" :key="row" class="h-12 w-full" /></div>
      <UAlert v-else-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="errorText">
        <template #actions><UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('meetingMinutesForm.retry')" @click="emit('retry')" /></template>
      </UAlert>
      <SharedEmptyState v-else-if="!versions.length" :title="t('meetingMinutesForm.noVersions')" />
      <ol v-else class="grid gap-2">
        <li v-for="version in versions" :key="version.id">
          <UButton
            type="button"
            color="neutral"
            :variant="selectedId === version.id ? 'subtle' : 'outline'"
            class="grid w-full min-w-0 justify-items-start gap-1 p-3 text-start"
            :class="selectedId === version.id ? 'ring-primary' : ''"
            :aria-pressed="selectedId === version.id"
            :data-selected="selectedId === version.id ? 'true' : undefined"
            :disabled="!hydrated"
            @click="emit('select', version)"
          >
            <span class="font-medium text-highlighted">{{ t('meetingMinutesForm.versionNumber', { number: version.number }) }}</span>
            <span class="text-xs text-muted">{{ capturedAt(version.captured_at) }} · {{ version.actor?.name || t('meetingMinutesForm.systemActor') }}</span>
          </UButton>
        </li>
      </ol>
      <SharedPagination :page="page" :pages="pages" :disabled="loading" @update:page="emit('page', $event)" />
    </div>
  </UCard>
</template>
