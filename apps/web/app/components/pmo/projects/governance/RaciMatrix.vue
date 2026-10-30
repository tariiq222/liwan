<script setup lang="ts">
import type { ProjectRaci, ProjectRaciRole } from '@liwan/contracts'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { RACI_ROLE_TONE } from './state'

// Tasks × stakeholders, bare: the page puts it inside its SharedListCard. The record number and the task name stay in view
// (sticky, on the card surface) while the stakeholder columns scroll inside this container, so the page itself never
// overflows. A manager edits a cell through a select whose face is the role chip; a viewer sees the chip. The page owns
// the data and the mutations; this draws and emits.
type Ref = { id: number; name: string }
const props = defineProps<{
  projectId: number
  tasks: Ref[]
  stakeholders: Ref[]
  assignments: Map<string, ProjectRaci>
  canManage: boolean
  locked: boolean
  returnTo: string
}>()
const emit = defineEmits<{ change: [taskId: number, stakeholderId: number, value: string] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const ROLES: ProjectRaciRole[] = ['R', 'A', 'C', 'I']
const roleItems = [{ value: 'none', label: '—' }, ...ROLES.map(role => ({ value: role, label: role }))]
const role = (taskId: number, stakeholderId: number) => props.assignments.get(`${taskId}:${stakeholderId}`)?.role
const NumberHeader = () => recordNumberHeader(t)
const helpId = useId()
// The sticky cells repeat the row tint, or the hover would stop at their edge.
const STICKY = 'sticky z-10 bg-default group-hover:bg-(--liwan-row-hover)'
</script>

<template>
  <div>
    <div data-testid="raci-matrix" class="max-w-full overflow-x-auto overscroll-x-contain">
      <table class="w-full min-w-max text-start text-sm" :aria-describedby="helpId">
        <thead>
          <tr class="h-10 border-b border-default bg-muted text-xs font-medium text-muted">
            <th scope="col" class="sticky start-0 z-10 w-12 min-w-12 bg-muted px-2 text-start font-medium"><NumberHeader /></th>
            <th scope="col" class="sticky start-12 z-10 min-w-56 bg-muted px-(--liwan-card-pad-dense) text-start font-medium">{{ t('projects.governance.raci.task') }}</th>
            <th v-for="item in stakeholders" :key="item.id" scope="col" class="min-w-32 px-(--liwan-card-pad-dense) text-start font-medium">
              <NuxtLink class="hover:text-highlighted hover:underline" :to="{ path: `/projects/${projectId}/stakeholders/${item.id}`, query: { returnTo } }">{{ item.name }}</NuxtLink>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.id" class="group h-(--liwan-row-h) border-b border-default transition-colors duration-150 last:border-b-0 hover:bg-(--liwan-row-hover) motion-reduce:transition-none">
            <td :class="[STICKY, 'start-0 w-12 min-w-12 px-2']"><RecordNumber :value="task.id" /></td>
            <th scope="row" :class="[STICKY, 'start-12 min-w-56 px-(--liwan-card-pad-dense) text-start']">
              <NuxtLink class="block max-w-72 truncate text-base font-semibold text-highlighted hover:underline" :to="{ path: `/projects/${projectId}/tasks/${task.id}`, query: { returnTo } }" :title="task.name">{{ task.name }}</NuxtLink>
            </th>
            <td v-for="item in stakeholders" :key="item.id" class="px-(--liwan-card-pad-dense)" data-testid="raci-cell">
              <USelect
                v-if="canManage"
                variant="ghost"
                :model-value="role(task.id, item.id) ?? 'none'"
                :items="roleItems"
                :aria-label="`${task.name} — ${item.name} — ${t('projects.governance.raci.role')}`"
                class="min-w-20"
                :ui="{ base: 'rounded-full' }"
                :disabled="!hydrated || locked"
                @update:model-value="emit('change', task.id, item.id, $event as string)"
              >
                <template #default>
                  <SharedStatusBadge v-if="role(task.id, item.id)" class="min-w-8 justify-center" :tone="RACI_ROLE_TONE[role(task.id, item.id)!]" :label="role(task.id, item.id)!" />
                  <span v-else class="text-dimmed">—</span>
                </template>
              </USelect>
              <SharedStatusBadge v-else-if="role(task.id, item.id)" class="min-w-8 justify-center" :tone="RACI_ROLE_TONE[role(task.id, item.id)!]" :label="role(task.id, item.id)!" />
              <span v-else class="text-dimmed">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p :id="helpId" class="border-t border-default px-(--liwan-card-pad) py-3 text-xs text-muted">{{ t(canManage ? 'projects.governance.raci.matrixHelp' : 'projects.governance.raci.matrixHelpReadonly') }}</p>
  </div>
</template>
