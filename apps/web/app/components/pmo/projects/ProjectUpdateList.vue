<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@/utils/statusBadge'
import type { ProjectUpdate } from '@nasq/contracts'
import { formatCalendarDate } from '@nasq/ui/app/composables/calendarDate'
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

// The «show more» toggle appears only when the collapsed description is really cut off.
const listEl = ref<HTMLElement | null>(null)
const bodyEls = new Map<number, HTMLElement>()
const clamped = ref(new Set<number>())
function setBodyEl(id: number, el: unknown) {
  if (el instanceof HTMLElement) bodyEls.set(id, el)
  else bodyEls.delete(id)
}
function measure() {
  const next = new Set(clamped.value)
  for (const [id, el] of bodyEls) {
    if (expanded.value.has(id)) continue // keep the toggle so the text can be collapsed again
    if (el.scrollHeight > el.clientHeight + 1) next.add(id)
    else next.delete(id)
  }
  clamped.value = next
}
useResizeObserver(listEl, measure)
watch(items, () => nextTick(measure), { flush: 'post' })
onMounted(measure)

const DOT_CLASS: Record<string, string> = { success: 'bg-success', warning: 'bg-warning', destructive: 'bg-error' }
function dotClass(status: ProjectStatus | null): string {
  return DOT_CLASS[projectBadge(status).tone] ?? 'bg-accented'
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
  <ol v-else ref="listEl">
    <li v-for="(u, index) in items" :key="u.id" class="flex gap-3" :class="index < items.length - 1 ? 'pb-3' : ''">
      <div class="relative flex w-3 shrink-0 justify-center" aria-hidden="true">
        <span v-if="items.length > 1" class="w-px self-stretch bg-accented" :class="index === 0 ? 'mt-4' : index === items.length - 1 ? 'mb-auto max-h-4' : ''" />
        <span class="absolute inset-x-0 top-4 mx-auto size-2.5 rounded-full" :class="dotClass(u.status)" />
      </div>
      <UCard as="article" data-testid="project-update" class="min-w-0 flex-1" :ui="{ body: 'p-3 sm:p-3 grid gap-1.5' }">
        <div class="flex min-w-0 items-center justify-between gap-2">
          <h3 class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted">{{ u.name }}</h3>
          <SharedStatusBadge v-bind="projectBadge(u.status)" data-testid="project-status" class="shrink-0" />
        </div>
        <p class="text-xs text-muted">{{ t('projects.updates.by', { name: u.author.name }) }} · {{ dateLabel(u.date) }}</p>
        <div :ref="(el) => setBodyEl(u.id, el)" :class="expanded.has(u.id) ? '' : 'line-clamp-2'">
          <SharedRichText size="sm" :html="u.description_html" />
        </div>
        <UButton v-if="clamped.has(u.id)" color="neutral" variant="link" size="xs" class="justify-self-start px-0" :disabled="!hydrated" :aria-expanded="expanded.has(u.id)" :label="expanded.has(u.id) ? t('projects.updates.showLess') : t('projects.updates.showMore')" @click="toggle(u.id)" />
      </UCard>
    </li>
  </ol>
</template>
