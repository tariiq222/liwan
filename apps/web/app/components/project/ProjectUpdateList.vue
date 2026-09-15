<script setup lang="ts">
import type { ProjectUpdate } from '@nasq/contracts'
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
  <UCard :ui="{ body: 'p-0' }">
    <!-- The updates page names the section in its own header; the card repeats it only where it stands alone. -->
    <template v-if="showCreate" #header>
      <div class="flex flex-row items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-highlighted">{{ t('projects.tabs.updates') }}</h2>
          <p class="text-sm text-muted">{{ t('projects.updates.emptyHint') }}</p>
        </div>
        <UButton v-if="showCreate && canManage" data-testid="project-update-new" size="sm" icon="i-lucide-plus" :disabled="!hydrated" :label="t('projects.updates.new')" @click="openCreate" />
      </div>
    </template>
    <div v-if="isLoading" class="space-y-3 p-4">
      <USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
    </div>
    <SharedPageState v-else-if="error" :error="error" @retry="refetch" />
    <div v-else-if="items.length === 0" class="p-8 text-center">
      <p class="font-medium">{{ t('projects.updates.empty') }}</p>
      <p class="mt-1 text-sm text-muted">{{ t('projects.updates.emptyHint') }}</p>
      <UButton v-if="showCreate && canManage" size="sm" icon="i-lucide-plus" class="mt-3" :disabled="!hydrated" :label="t('projects.updates.new')" @click="openCreate" />
    </div>
    <ol v-else class="grid gap-3 p-4">
      <li v-for="(u, index) in items" :key="u.id" class="relative flex gap-3">
        <div class="relative flex w-3 shrink-0 justify-center">
          <span class="mt-3.5 size-2.5 rounded-full border-2 border-default bg-primary ring-1 ring-primary" />
          <span v-if="index < items.length - 1" class="absolute -bottom-3 top-6 border-s border-default" />
        </div>
        <UCard as="article" data-testid="project-update" class="min-w-0 flex-1" :ui="{ body: 'p-3 sm:p-3 grid gap-1.5' }">
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <ProjectStatusBadge :status="u.status" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">{{ u.name }}</span>
            <span class="text-xs text-muted">{{ t('projects.updates.by', { name: u.author.name }) }}</span>
            <span class="text-xs text-muted">·</span>
            <span class="shrink-0 text-xs text-muted">{{ dateLabel(u.date) }}</span>
          </div>
          <div :class="expanded.has(u.id) ? '' : 'line-clamp-2'">
            <SharedRichText size="sm" :html="u.description_html" />
          </div>
          <UButton
            color="neutral"
            variant="link"
            size="xs"
            class="justify-self-start px-0"
            :disabled="!hydrated"
            :aria-expanded="expanded.has(u.id)"
            :label="expanded.has(u.id) ? t('projects.updates.showLess') : t('projects.updates.showMore')"
            @click="toggle(u.id)"
          />
        </UCard>
      </li>
    </ol>
  </UCard>
</template>
