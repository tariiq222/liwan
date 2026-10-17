<script setup lang="ts">
import { formatWebVueDateTime } from '@webvue/ui/app/composables/calendarDate'

type MeetingVersion = {
  id: number
  number: number
  captured_at: string
  actor: { id: number; name: string } | null
  snapshot: Record<string, unknown> | null
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

function capturedAt(value: string) {
  return formatWebVueDateTime(value, locale.value)
}
</script>

<template>
  <SharedRecordSection data-testid="meeting-version-list" variant="list" :title="t('meetingMinutesForm.versions')">
    <SharedPageState :loading="loading" :error="error" :empty="!versions.length" :empty-text="t('meetingMinutesForm.noVersions')" @retry="emit('retry')">
      <ol class="divide-y divide-default">
        <li v-for="version in versions" :key="version.id">
          <button
            type="button"
            class="grid w-full min-w-0 justify-items-start gap-1 px-(--webvue-card-pad) py-3 text-start transition-colors duration-150 hover:bg-(--webvue-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-60 motion-reduce:transition-none"
            :class="selectedId === version.id ? 'bg-primary/5' : ''"
            :aria-pressed="selectedId === version.id"
            :data-selected="selectedId === version.id ? 'true' : undefined"
            :disabled="!hydrated"
            @click="emit('select', version)"
          >
            <span class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="font-semibold text-highlighted">{{ t('meetingMinutesForm.versionNumber', { number: version.number }) }}</span>
              <UBadge v-if="selectedId === version.id" color="primary" variant="subtle" size="sm">{{ t('meetingMinutesForm.selectedVersion') }}</UBadge>
            </span>
            <span class="text-xs text-muted">{{ capturedAt(version.captured_at) }} · {{ version.actor?.name || t('meetingMinutesForm.systemActor') }}</span>
          </button>
        </li>
      </ol>
    </SharedPageState>
    <div v-if="pages > 1" class="border-t border-default px-(--webvue-card-pad) py-3">
      <SharedPagination :page="page" :pages="pages" :disabled="loading" @update:page="emit('page', $event)" />
    </div>
  </SharedRecordSection>
</template>
