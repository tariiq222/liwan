<script setup lang="ts">
import type { Milestone } from '@nasq/contracts'
import { getLocalTimeZone, today } from '@internationalized/date'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { TONE_CLASS } from '@/composables/taskState'
import { useDeleteMilestone, useMilestones, useUpdateMilestone } from '@/composables/useMilestones'
import MilestoneDialog from './MilestoneDialog.vue'

const props = defineProps<{ projectId: number; canManage: boolean }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()

const projectIdRef = computed(() => props.projectId)
const { data, isLoading } = useMilestones(projectIdRef)
const items = computed<Milestone[]>(() => data.value ?? [])
const columnCount = computed(() => (props.canManage ? 5 : 4))

// --- create/edit: the table owns the dialog, the "New milestone" button
// emits nothing (see task-11 brief) --------------------------------------
const dialogOpen = ref(false)
const editingMilestone = ref<Milestone | undefined>(undefined)

function openCreate() {
  editingMilestone.value = undefined
  dialogOpen.value = true
}
function openEdit(m: Milestone) {
  editingMilestone.value = m
  dialogOpen.value = true
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
// No `ui/alert-dialog` component exists yet in this tree (another task is
// adding one) — a plain Dialog stands in for the delete confirm, same
// workaround ProjectMenu.vue and TaskDetailPanel.vue use elsewhere.
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
  <div class="space-y-2">
    <div v-if="canManage" class="flex justify-end">
      <Button data-testid="milestone-new" :disabled="!hydrated" @click="openCreate">
        {{ t('projects.milestones.new') }}
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="text-start">{{ t('projects.milestones.name') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.milestones.deadline') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.milestones.tasks') }}</TableHead>
            <TableHead class="text-start">{{ t('projects.milestones.state') }}</TableHead>
            <TableHead v-if="canManage" class="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="isLoading">
            <TableRow v-for="n in 3" :key="n">
              <TableCell :colspan="columnCount"><Skeleton class="h-5 w-full" /></TableCell>
            </TableRow>
          </template>
          <TableEmpty v-else-if="items.length === 0" :colspan="columnCount">
            <p class="text-muted-foreground">{{ t('projects.milestones.empty') }}</p>
          </TableEmpty>
          <template v-else>
            <TableRow v-for="m in items" :key="m.id" data-testid="milestone-row">
              <TableCell>{{ m.name }}</TableCell>
              <TableCell>
                <Badge variant="outline" :class="TONE_CLASS[deadlineTone(m)]">{{ deadlineText(m) }}</Badge>
              </TableCell>
              <TableCell>{{ t('projects.milestones.tasksOf', { done: m.done_task_count, total: m.task_count }) }}</TableCell>
              <TableCell>
                <Badge variant="outline" :class="TONE_CLASS[m.is_reached ? 'success' : 'neutral']">
                  {{ t(m.is_reached ? 'projects.milestones.reached' : 'projects.milestones.notReached') }}
                </Badge>
              </TableCell>
              <TableCell v-if="canManage">
                <DropdownMenu>
                  <DropdownMenuTrigger as-child :disabled="!hydrated">
                    <button
                      type="button"
                      class="inline-flex items-center rounded px-1 text-sm leading-none text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                      :disabled="!hydrated"
                    >
                      ⋯
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @select="openEdit(m)">{{ t('projects.milestones.edit') }}</DropdownMenuItem>
                    <DropdownMenuItem @select="toggleReached(m)">
                      {{ t(m.is_reached ? 'projects.milestones.reopen' : 'projects.milestones.markReached') }}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <Tooltip v-if="m.task_count > 0">
                      <TooltipTrigger as-child>
                        <span class="block">
                          <DropdownMenuItem disabled variant="destructive">{{ t('projects.milestones.delete') }}</DropdownMenuItem>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{{ t('projects.milestones.hasTasks', { count: m.task_count }) }}</TooltipContent>
                    </Tooltip>
                    <DropdownMenuItem v-else variant="destructive" @select="deleteTarget = m">
                      {{ t('projects.milestones.delete') }}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>
  </div>

  <MilestoneDialog :open="dialogOpen" :project-id="projectId" :milestone="editingMilestone" @update:open="(v) => (dialogOpen = v)" />

  <Dialog :open="!!deleteTarget" @update:open="(v) => { if (!v) deleteTarget = null }">
    <DialogContent v-if="deleteTarget">
      <DialogHeader>
        <DialogTitle>{{ t('projects.milestones.delete') }}</DialogTitle>
        <DialogDescription>{{ deleteTarget.name }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" type="button" :disabled="deleting" @click="deleteTarget = null">{{ t('app.cancel') }}</Button>
        <Button variant="destructive" type="button" :disabled="deleting" @click="confirmDelete">{{ t('projects.milestones.delete') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
