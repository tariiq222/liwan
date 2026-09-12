<script setup lang="ts">
import { useHrEmployee } from '@/composables/useHrEmployees'
import AccessBadge from './AccessBadge.vue'

const props = defineProps<{ employeeId: number }>()

const { t } = useI18n()
const { can } = useAccess()
const canSeeAccess = computed(() => can('hr.employees.access_status.read'))
const id = computed(() => props.employeeId)
const { data: employee, isLoading } = useHrEmployee(id)
</script>

<template>
  <div class="grid gap-6 items-start lg:grid-cols-[2fr_1fr]">
    <template v-if="isLoading">
      <UCard class="nasq-ui-record-surface">
        <div class="grid gap-4">
          <USkeleton class="size-16 rounded-full" />
          <USkeleton class="h-5 w-40" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-3/4" />
        </div>
      </UCard>
    </template>
    <template v-else-if="employee">
      <UCard class="nasq-ui-record-surface">
        <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('hr.card.overview') }}</h2></template>
        <div class="mb-4 flex items-center gap-3">
          <img
            :src="`/web/image/hr.employee/${employee.id}/avatar_128`"
            :alt="employee.name"
            class="size-11 rounded-full bg-elevated object-cover"
          >
          <p class="truncate text-sm text-muted">{{ employee.job_title || '—' }}</p>
        </div>
        <dl class="grid gap-4 sm:grid-cols-2">
          <div><dt class="text-sm text-muted">{{ t('hr.card.jobTitle') }}</dt><dd class="mt-1 font-medium">{{ employee.job_title || '—' }}</dd></div>
          <div><dt class="text-sm text-muted">{{ t('hr.card.department') }}</dt><dd class="mt-1 font-medium">{{ employee.department?.name || '—' }}</dd></div>
          <div><dt class="text-sm text-muted">{{ t('hr.card.email') }}</dt><dd class="mt-1 font-medium" dir="ltr">{{ employee.work_email || '—' }}</dd></div>
          <div><dt class="text-sm text-muted">{{ t('hr.card.phone') }}</dt><dd class="mt-1 font-medium" dir="ltr">{{ employee.work_phone || '—' }}</dd></div>
          <div><dt class="text-sm text-muted">{{ t('hr.card.manager') }}</dt><dd class="mt-1 font-medium">{{ employee.manager?.name || '—' }}</dd></div>
        </dl>
      </UCard>
      <aside v-if="canSeeAccess" class="grid content-start gap-4">
        <UCard class="nasq-ui-record-surface" :ui="{ header: 'nasq-ui-card-header' }">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('hr.card.account') }}</h2></template>
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-3 text-sm">
              <span class="text-muted">{{ t('hr.card.account') }}</span>
              <AccessBadge :access="employee.access" />
            </div>
            <p class="text-xs leading-5 text-muted">{{ $t('hr.employee.accessManagedInSettings') }}</p>
          </div>
        </UCard>
      </aside>
    </template>
  </div>
</template>
