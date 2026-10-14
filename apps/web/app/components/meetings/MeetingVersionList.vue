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

function capturedAt(value: string) {
  return formatNasqDateTime(value, locale.value)
}
</script>

<template>
  <section data-testid="meeting-version-list" class="space-y-3" aria-labelledby="meeting-version-list-title">
    <h2 id="meeting-version-list-title" class="sr-only">{{ t('meetingMinutesForm.versions') }}</h2>
    <SharedPageState :loading="loading" :error="error" :empty="!versions.length" :empty-text="t('meetingMinutesForm.noVersions')" @retry="emit('retry')">
      <ol class="grid gap-2">
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
    </SharedPageState>
    <SharedPagination :page="page" :pages="pages" :disabled="loading" @update:page="emit('page', $event)" />
  </section>
</template>
