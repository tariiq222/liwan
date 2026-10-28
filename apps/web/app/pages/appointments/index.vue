<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { AppointmentTypeListSchema } from '@webvue/contracts'

const { t } = useI18n()
const { $api } = useApi()
const types = useQuery({
  queryKey: ['appointments', 'types'],
  queryFn: () => $api('/api/v1/appointments/types', { schema: AppointmentTypeListSchema }),
})
const items = computed(() => types.data.value?.items ?? [])
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('appointments.title')" />
    <SharedPageState
      :loading="types.isPending.value"
      :error="types.error.value"
      :empty="items.length === 0"
      :empty-text="t('appointments.empty')"
      @retry="types.refetch()"
    >
      <ul class="divide-y divide-default rounded-xl border border-default">
        <li v-for="item in items" :key="item.id" class="flex items-center justify-between gap-4 px-4 py-3 text-start">
          <span>{{ item.name }}</span>
          <span class="text-sm text-muted">{{ t('appointments.duration', { count: item.duration_minutes }) }}</span>
        </li>
      </ul>
    </SharedPageState>
  </SharedPageContainer>
</template>
