<script setup lang="ts">
import type { ProjectRaci, ProjectRaciRole } from '@nasq/contracts'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { STATUS_COLOR } from '@/utils/statusTone'
import { RACI_ROLE_TONE } from './state'

// Tasks × stakeholders. The first two columns stay in view while the stakeholder columns scroll inside this
// container, so the page itself never overflows. The page owns the data and the mutations; this draws and emits.
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
const color = (taskId: number, stakeholderId: number) => {
  const value = role(taskId, stakeholderId)
  return value ? STATUS_COLOR[RACI_ROLE_TONE[value]] : undefined
}
</script>

<template>
  <section data-testid="raci-matrix" class="max-w-full overflow-x-auto overscroll-x-contain rounded-lg bg-default ring ring-default">
    <table class="w-full min-w-max text-start text-sm">
      <caption class="p-3 text-start">{{ t('projects.governance.raci.matrixHelp') }}</caption>
      <thead>
        <tr class="border-b border-default">
          <th scope="col" class="sticky start-0 z-10 h-auto w-28 min-w-28 max-w-28 bg-default p-3 text-start">{{ t('app.recordNumber') }}</th>
          <th scope="col" class="sticky start-28 z-10 min-w-48 bg-default p-3 text-start">{{ t('projects.governance.raci.task') }}</th>
          <th v-for="item in stakeholders" :key="item.id" scope="col" class="min-w-32 p-3 text-start">
            <NuxtLink class="underline" :to="{ path: `/projects/${projectId}/stakeholders/${item.id}`, query: { returnTo } }">{{ item.name }}</NuxtLink>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.id" class="border-b border-default">
          <td class="sticky start-0 z-10 h-auto w-28 min-w-28 max-w-28 bg-default p-3"><RecordNumber :value="task.id" /></td>
          <th scope="row" class="sticky start-28 z-10 bg-default p-3 text-start font-medium">
            <NuxtLink class="underline" :to="{ path: `/projects/${projectId}/tasks/${task.id}` }">{{ task.name }}</NuxtLink>
          </th>
          <td v-for="item in stakeholders" :key="item.id" class="p-3" data-testid="raci-cell">
            <USelect
              v-if="canManage"
              :model-value="role(task.id, item.id) ?? 'none'"
              :items="roleItems"
              :aria-label="`${task.name} — ${item.name} — ${t('projects.governance.raci.role')}`"
              class="min-w-24"
              :color="color(task.id, item.id)"
              :disabled="!hydrated || locked"
              @update:model-value="emit('change', task.id, item.id, $event as string)"
            />
            <SharedStatusBadge v-else-if="role(task.id, item.id)" :tone="RACI_ROLE_TONE[role(task.id, item.id)!]" :label="role(task.id, item.id)!" />
            <span v-else>—</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="p-3 text-sm text-muted">{{ t('projects.governance.raci.legend') }}</p>
  </section>
</template>
