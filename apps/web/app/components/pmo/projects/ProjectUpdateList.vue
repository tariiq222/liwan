<script setup lang="ts">
import type { ProjectStatus } from '@liwan/contracts'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import type { ProjectUpdate } from '@liwan/contracts'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'

const props = defineProps<{ projectId: number; canManage: boolean }>()

const { t } = useI18n()
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
  return formatCalendarDate(iso)
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

function openCreate() {
  router.push({ path: `/projects/${props.projectId}/updates/new`, query: returnToQuery(route.fullPath) })
}
</script>

<template>
  <SharedLoadingSkeleton v-if="isLoading" />
  <SharedPageState v-else-if="error" :error="error" @retry="refetch" />
  <SharedEmptyState v-else-if="items.length === 0" bordered :title="t('projects.updates.empty')" :description="t('projects.updates.emptyHint')">
    <template v-if="canManage" #action>
      <UButton data-testid="project-update-new" size="sm" icon="i-lucide-plus" :disabled="!hydrated" :label="t('projects.updates.new')" @click="openCreate" />
    </template>
  </SharedEmptyState>
  <SharedListCard v-else>
    <ol ref="listEl" class="divide-y divide-default">
      <li v-for="u in items" :key="u.id">
        <article data-testid="project-update" class="grid min-w-0 gap-2 px-(--liwan-card-pad) py-4">
          <div class="flex min-w-0 items-center justify-between gap-3">
            <h3 class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted">{{ u.name }}</h3>
            <SharedStatusBadge v-bind="projectBadge(u.status)" data-testid="project-status" class="shrink-0" />
          </div>
          <p class="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <SharedPersonAvatar :people="[u.author]" />
            <span>{{ t('projects.updates.by', { name: u.author.name }) }}</span>
            <span aria-hidden="true">·</span>
            <bdi>{{ dateLabel(u.date) }}</bdi>
          </p>
          <div :ref="(el) => setBodyEl(u.id, el)" :class="expanded.has(u.id) ? '' : 'line-clamp-2'">
            <SharedRichText size="sm" :html="u.description_html" />
          </div>
          <UButton v-if="clamped.has(u.id)" color="neutral" variant="link" size="xs" class="justify-self-start px-0" :disabled="!hydrated" :aria-expanded="expanded.has(u.id)" :label="expanded.has(u.id) ? t('projects.updates.showLess') : t('projects.updates.showMore')" @click="toggle(u.id)" />
        </article>
      </li>
    </ol>
  </SharedListCard>
</template>
