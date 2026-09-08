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
  <div class="nasq-detail-grid">
    <template v-if="isLoading">
      <div class="nasq-panel nasq-panel-body grid gap-4">
        <Skeleton class="size-16 rounded-full" />
        <Skeleton class="h-5 w-40" />
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-3/4" />
      </div>
    </template>
    <template v-else-if="employee">
      <section class="nasq-panel nasq-panel-body">
        <div class="mb-4 flex items-center gap-3">
          <img
            :src="`/web/image/hr.employee/${employee.id}/avatar_128`"
            :alt="employee.name"
            class="size-11 rounded-full bg-muted object-cover"
          >
          <p class="truncate text-sm text-muted-foreground">{{ employee.job_title || '—' }}</p>
        </div>
        <dl class="nasq-metadata">
          <div><dt>{{ t('hr.card.jobTitle') }}</dt><dd>{{ employee.job_title || '—' }}</dd></div>
          <div><dt>{{ t('hr.card.department') }}</dt><dd>{{ employee.department?.name || '—' }}</dd></div>
          <div><dt>{{ t('hr.card.email') }}</dt><dd dir="ltr">{{ employee.work_email || '—' }}</dd></div>
          <div><dt>{{ t('hr.card.phone') }}</dt><dd dir="ltr">{{ employee.work_phone || '—' }}</dd></div>
          <div><dt>{{ t('hr.card.manager') }}</dt><dd>{{ employee.manager?.name || '—' }}</dd></div>
        </dl>
      </section>
      <aside v-if="canSeeAccess" class="grid content-start gap-4">
        <section class="nasq-panel nasq-panel-body grid gap-3">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-muted-foreground">{{ t('hr.card.account') }}</span>
            <AccessBadge :access="employee.access" />
          </div>
          <p class="text-xs leading-5 text-muted-foreground">{{ $t('hr.employee.accessManagedInSettings') }}</p>
        </section>
      </aside>
    </template>
  </div>
</template>
