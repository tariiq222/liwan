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
      <div class="nasq-panel">
        <div class="nasq-panel-header">
          <div class="flex min-w-0 items-center gap-3">
            <img
              :src="`/web/image/hr.employee/${employee.id}/avatar_128`"
              :alt="employee.name"
              class="size-11 rounded-full bg-muted object-cover"
            >
            <div class="min-w-0">
              <h2 class="truncate text-base font-semibold">{{ employee.name }}</h2>
              <p class="truncate text-xs text-muted-foreground">{{ employee.job_title || '—' }}</p>
            </div>
          </div>
        </div>
        <div class="nasq-panel-body">
          <h3 class="mb-3 text-sm font-semibold">{{ t('hr.card.overview') }}</h3>
          <dl class="nasq-metadata">
            <div><dt>{{ t('hr.card.jobTitle') }}</dt><dd>{{ employee.job_title || '—' }}</dd></div>
            <div><dt>{{ t('hr.card.department') }}</dt><dd>{{ employee.department?.name || '—' }}</dd></div>
            <div><dt>{{ t('hr.card.email') }}</dt><dd dir="ltr">{{ employee.work_email || '—' }}</dd></div>
            <div><dt>{{ t('hr.card.phone') }}</dt><dd dir="ltr">{{ employee.work_phone || '—' }}</dd></div>
            <div><dt>{{ t('hr.card.manager') }}</dt><dd>{{ employee.manager?.name || '—' }}</dd></div>
          </dl>
        </div>
      </div>
      <aside class="grid content-start gap-4">
        <section v-if="canSeeAccess" class="nasq-panel">
          <div class="nasq-panel-header"><h2 class="text-sm font-semibold">{{ t('hr.card.account') }}</h2></div>
          <div class="nasq-panel-body grid gap-3">
            <div class="flex items-center justify-between gap-3 text-sm"><span class="text-muted-foreground">{{ t('hr.card.account') }}</span><AccessBadge :access="employee.access" /></div>
            <p class="text-xs leading-5 text-muted-foreground">{{ $t('hr.employee.accessManagedInSettings') }}</p>
          </div>
        </section>
        <section class="nasq-panel">
          <div class="nasq-panel-header"><h2 class="text-sm font-semibold">{{ t('hr.card.department') }}</h2></div>
          <div class="nasq-panel-body"><p class="text-sm">{{ employee.department?.name || '—' }}</p><p class="mt-1 text-xs text-muted-foreground">{{ t('hr.card.manager') }}: {{ employee.manager?.name || '—' }}</p></div>
        </section>
      </aside>
    </template>
  </div>
</template>
