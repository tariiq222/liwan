<script setup lang="ts">
import type { ProjectUpdate } from '@nasq/contracts'
import { sanitizeHtml } from '@/utils/sanitize'
import { formatCalendarDate } from '@/composables/calendarDate'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = withDefaults(defineProps<{ projectId: number; canManage: boolean; showCreate?: boolean }>(), { showCreate: true })

const { t, locale } = useI18n()
const hydrated = useHydrated()

const projectIdRef = computed(() => props.projectId)
const { data, isLoading, error, refetch } = useProjectUpdates(projectIdRef)
const items = computed<ProjectUpdate[]>(() => [...(data.value ?? [])].sort((a, b) => b.date.localeCompare(a.date)))
const router = useRouter()
const route = useRoute()

// u.date is a YYYY-MM-DD calendar date, not an instant — new Date(iso) parses
// it as UTC midnight and renders a day early west of Greenwich.
function dateLabel(iso: string): string {
  return formatCalendarDate(iso, locale.value)
}

function openCreate() {
  router.push({ path: `/projects/${props.projectId}/updates/new`, query: returnToQuery(route.fullPath) })
}
</script>

<template>
  <UCard :ui="{ body: 'p-0' }">
    <template #header>
      <div class="flex flex-row items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-highlighted">{{ t('projects.tabs.updates') }}</h2>
          <p class="text-sm text-muted">{{ t('projects.updates.emptyHint') }}</p>
        </div>
        <UButton v-if="showCreate && canManage" data-testid="project-update-new" size="sm" :disabled="!hydrated" :label="t('projects.updates.new')" @click="openCreate" />
      </div>
    </template>
    <div v-if="isLoading" class="space-y-3 p-[18px]">
      <USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
    </div>
    <SharedPageState v-else-if="error" :error="error" @retry="refetch" />
    <div v-else-if="items.length === 0" class="p-8 text-center">
      <p class="font-medium">{{ t('projects.updates.empty') }}</p>
      <p class="mt-1 text-sm text-muted">{{ t('projects.updates.emptyHint') }}</p>
      <UButton v-if="showCreate && canManage" size="sm" class="mt-3" :disabled="!hydrated" :label="t('projects.updates.new')" @click="openCreate" />
    </div>
    <div v-else class="px-[18px] py-1">
      <article v-for="(u, index) in items" :key="u.id" data-testid="project-update" class="relative flex gap-4 py-4">
        <div class="relative flex w-3 shrink-0 justify-center">
          <span class="mt-1.5 size-2.5 rounded-full border-2 border-default bg-primary ring-1 ring-primary" />
          <span v-if="index < items.length - 1" class="absolute bottom-[-16px] top-5 border-s border-default" />
        </div>
        <div class="min-w-0 flex-1 space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2"><ProjectStatusBadge :status="u.status" /><span class="truncate font-medium">{{ u.name }}</span></div>
            <span class="shrink-0 text-xs text-muted">{{ dateLabel(u.date) }}</span>
          </div>
          <p class="text-xs text-muted">{{ t('projects.updates.by', { name: u.author.name }) }}</p>
          <div class="prose prose-sm max-w-none break-words text-sm" v-html="sanitizeHtml(u.description_html)" />
        </div>
      </article>
    </div>
  </UCard>
</template>
