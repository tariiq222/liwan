<script setup lang="ts">
import { useHrEmployee } from '@/composables/useHrEmployees'

const props = defineProps<{ employeeId: number }>()

const { t } = useI18n()
const id = computed(() => props.employeeId)
const { data: employee, isLoading } = useHrEmployee(id)
</script>

<template>
  <div class="grid gap-4 ps-4 pe-4 pb-4">
    <template v-if="isLoading">
      <Skeleton class="size-16 rounded-full" />
      <Skeleton class="h-5 w-40" />
      <Skeleton class="h-4 w-full" />
      <Skeleton class="h-4 w-3/4" />
    </template>
    <template v-else-if="employee">
      <div class="flex items-center gap-3">
        <img
          :src="`/web/image/hr.employee/${employee.id}/avatar_128`"
          :alt="employee.name"
          class="size-16 rounded-full bg-muted object-cover"
        >
        <div class="min-w-0">
          <p class="truncate text-lg font-semibold">{{ employee.name }}</p>
          <p class="truncate text-sm text-muted-foreground">{{ employee.job_title || '—' }}</p>
        </div>
      </div>
      <dl class="grid gap-3 text-sm">
        <div>
          <dt class="text-muted-foreground">{{ t('hr.card.jobTitle') }}</dt>
          <dd>{{ employee.job_title || '—' }}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground">{{ t('hr.card.department') }}</dt>
          <dd>{{ employee.department?.name || '—' }}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground">{{ t('hr.card.email') }}</dt>
          <dd>{{ employee.work_email || '—' }}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground">{{ t('hr.card.phone') }}</dt>
          <dd>{{ employee.work_phone || '—' }}</dd>
        </div>
      </dl>
    </template>
  </div>
</template>
