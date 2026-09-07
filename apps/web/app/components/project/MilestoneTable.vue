<script setup lang="ts">
import type { Milestone } from '@nasq/contracts'
import { CheckCircle2, Pencil, RotateCcw, Trash2 } from '@lucide/vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { STATUS_CHIP_CLASS, STATUS_TEXT_CLASS } from '@/utils/statusTone'
import { useDeleteMilestone, useMilestones, useUpdateMilestone } from '@/composables/useMilestones'
import EmptyState from '@/components/shared/EmptyState.vue'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = defineProps<{ projectId: number; canManage: boolean }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()

const projectIdRef = computed(() => props.projectId)
const { data, isLoading } = useMilestones(projectIdRef)
const items = computed<Milestone[]>(() => data.value ?? [])

const router = useRouter()
const route = useRoute()

function openCreate() {
  router.push({ path: `/projects/${props.projectId}/milestones/new`, query: returnToQuery(route.fullPath) })
}
function openEdit(m: Milestone) {
  router.push({ path: `/projects/${props.projectId}/milestones/${m.id}/edit`, query: returnToQuery(route.fullPath) })
}

// --- deadline tone ---------------------------------------------------------
// A milestone deadline is a calendar date, not an instant (see
// calendarDate.ts) — comparing it against `today()` in the viewer's own
// timezone avoids the UTC-midnight shift `new Date(...)` would introduce.
function isPastDeadline(deadline: string | null): boolean {
  const d = toCalendarDate(deadline)
  if (!d) return false
  return d.compare(today(getLocalTimeZone())) < 0
}
function deadlineTone(m: Milestone): 'destructive' | 'neutral' {
  return !m.is_reached && isPastDeadline(m.deadline) ? 'destructive' : 'neutral'
}
function deadlineText(m: Milestone): string {
  return m.deadline ? formatCalendarDate(m.deadline, locale.value) : '—'
}

// --- mark reached / reopen --------------------------------------------------
const { mutateAsync: updateMutate } = useUpdateMilestone()
async function toggleReached(m: Milestone) {
  try {
    await updateMutate({ projectId: props.projectId, id: m.id, patch: { is_reached: !m.is_reached } })
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}

// --- delete ------------------------------------------------------------
const { mutateAsync: deleteMutate, isPending: deleting } = useDeleteMilestone()
const deleteTarget = ref<Milestone | null>(null)

async function confirmDelete() {
  if (!deleteTarget.value) return
  try {
    await deleteMutate({ projectId: props.projectId, id: deleteTarget.value.id })
    deleteTarget.value = null
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="nasq-toolbar">
      <p class="min-w-0 flex-1 text-sm text-muted-foreground">{{ t('projects.milestones.emptyHint') }}</p>
      <Button v-if="canManage" data-testid="milestone-new" :disabled="!hydrated" @click="openCreate">{{ t('projects.milestones.new') }}</Button>
    </div>
    <div class="nasq-panel overflow-hidden">
      <div class="overflow-x-auto">
        <Table class="min-w-[720px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead class="text-start">{{ t('projects.tabs.milestones') }}</TableHead>
              <TableHead class="text-start">{{ t('projects.columns.dateEnd') }}</TableHead>
              <TableHead class="text-start">{{ t('projects.columns.progress') }}</TableHead>
              <TableHead v-if="canManage" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="isLoading || !hydrated">
              <TableRow v-for="n in 3" :key="n">
                <TableCell v-for="col in (canManage ? 4 : 3)" :key="col"><Skeleton class="h-5 w-full" /></TableCell>
              </TableRow>
            </template>
            <TableEmpty v-else-if="items.length === 0" :colspan="canManage ? 4 : 3">
              <EmptyState :title="t('projects.milestones.empty')" :description="t('projects.milestones.emptyHint')">
                <template v-if="canManage" #action>
                  <Button :disabled="!hydrated" @click="openCreate">{{ t('projects.milestones.new') }}</Button>
                </template>
              </EmptyState>
            </TableEmpty>
            <template v-else>
              <TableRow v-for="m in items" :key="m.id" data-testid="milestone-row">
                <TableCell>
                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <span class="font-medium">{{ m.name }}</span>
                    <Badge variant="outline" :class="STATUS_CHIP_CLASS[m.is_reached ? 'success' : 'neutral']">{{ t(m.is_reached ? 'projects.milestones.reached' : 'projects.milestones.notReached') }}</Badge>
                  </div>
                </TableCell>
                <TableCell :class="STATUS_TEXT_CLASS[deadlineTone(m)]">{{ deadlineText(m) }}</TableCell>
                <TableCell class="text-muted-foreground">{{ t('projects.milestones.tasksOf', { done: m.done_task_count, total: m.task_count }) }}</TableCell>
                <TableCell v-if="canManage" class="text-end">
                  <div class="flex flex-wrap items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" class="gap-1.5" :disabled="!hydrated" @click="toggleReached(m)">
                      <RotateCcw v-if="m.is_reached" class="size-4" /><CheckCircle2 v-else class="size-4" />{{ t(m.is_reached ? 'projects.milestones.reopen' : 'projects.milestones.markReached') }}
                    </Button>
                    <Button variant="ghost" size="sm" class="gap-1.5" :disabled="!hydrated" @click="openEdit(m)"><Pencil class="size-4" />{{ t('projects.milestones.edit') }}</Button>
                    <Tooltip v-if="m.task_count > 0">
                      <TooltipTrigger as-child><span><Button variant="ghost" size="icon" class="size-8" disabled><Trash2 class="size-4" /></Button></span></TooltipTrigger>
                      <TooltipContent>{{ t('projects.milestones.hasTasks', { count: m.task_count }) }}</TooltipContent>
                    </Tooltip>
                    <Button v-else variant="ghost" size="icon" class="size-8 text-destructive" :disabled="!hydrated" :aria-label="t('projects.milestones.delete')" @click="deleteTarget = m"><Trash2 class="size-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            </template>
          </TableBody>
        </Table>
      </div>
    </div>

    <div v-if="deleteTarget" data-testid="milestone-delete-confirm" class="nasq-status-callout-danger space-y-2 p-3 text-sm">
      <p class="font-medium">{{ t('projects.milestones.delete') }}</p>
      <p class="text-muted-foreground">{{ deleteTarget.name }}</p>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" type="button" :disabled="deleting" @click="deleteTarget = null">{{ t('app.cancel') }}</Button>
        <Button variant="destructive" type="button" :disabled="deleting" @click="confirmDelete">{{ t('projects.milestones.delete') }}</Button>
      </div>
    </div>
  </div>
</template>
