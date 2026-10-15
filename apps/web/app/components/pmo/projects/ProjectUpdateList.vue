<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@/utils/statusBadge'
import type { ProjectUpdate } from '@nasq/contracts'
import { formatCalendarDate } from '@/composables/calendarDate'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = defineProps<{ projectId: number; canManage: boolean }>()

const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
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

const expanded = ref(new Set<number>())
function toggle(id: number) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function openCreate() {
  router.push({ path: `/projects/${props.projectId}/updates/new`, query: returnToQuery(route.fullPath) })
}
</script>

<template>
  <SharedLoadingSkeleton v-if="isLoading" />
  <SharedPageState v-else-if="error" :error="error" @retry="refetch" />
  <SharedEmptyState v-else-if="items.length === 0" :title="t('projects.updates.empty')" :description="t('projects.updates.emptyHint')">
    <template v-if="canManage" #action>
      <UButton data-testid="project-update-new" size="sm" icon="i-lucide-plus" :disabled="!hydrated" :label="t('projects.updates.new')" @click="openCreate" />
    </template>
  </SharedEmptyState>
  <ol v-else class="grid gap-3">
    <li v-for="(u, index) in items" :key="u.id" class="relative flex gap-3">
      <div class="relative flex w-3 shrink-0 justify-center">
        <span class="mt-3.5 size-2.5 rounded-full border-2 border-default bg-primary ring-1 ring-primary" />
        <span v-if="index < items.length - 1" class="absolute -bottom-3 top-6 border-s border-default" />
      </div>
      <UCard as="article" data-testid="project-update" class="min-w-0 flex-1" :ui="{ body: 'p-3 sm:p-3 grid gap-1.5' }">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <SharedStatusBadge v-bind="projectBadge(u.status)" data-testid="project-status" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">{{ u.name }}</span>
          <span class="text-xs text-muted">{{ t('projects.updates.by', { name: u.author.name }) }}</span>
          <span class="text-xs text-muted">·</span>
          <span class="shrink-0 text-xs text-muted">{{ dateLabel(u.date) }}</span>
        </div>
        <div :class="expanded.has(u.id) ? '' : 'line-clamp-2'">
          <SharedRichText size="sm" :html="u.description_html" />
        </div>
        <UButton color="neutral" variant="link" size="xs" class="justify-self-start px-0" :disabled="!hydrated" :aria-expanded="expanded.has(u.id)" :label="expanded.has(u.id) ? t('projects.updates.showLess') : t('projects.updates.showMore')" @click="toggle(u.id)" />
      </UCard>
    </li>
  </ol>
</template>
