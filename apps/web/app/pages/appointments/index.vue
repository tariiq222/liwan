<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { AppointmentsRecordListSchema } from '@webvue/contracts'

const { t } = useI18n()
const { $api } = useApi()
const records = useQuery({
  queryKey: ['appointments', 'records'],
  queryFn: () => $api('/api/v1/appointments/records', { schema: AppointmentsRecordListSchema }),
})
const items = computed(() => records.data.value?.items ?? [])
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('appointments.title')" />
    <SharedPageState
      :loading="records.isPending.value"
      :error="records.error.value"
      :empty="items.length === 0"
      :empty-text="t('appointments.empty')"
      @retry="records.refetch()"
    >
      <ul class="divide-y divide-default rounded-xl border border-default">
        <li v-for="item in items" :key="item.id" class="px-4 py-3 text-start">
          {{ item.name }}
        </li>
      </ul>
    </SharedPageState>
  </SharedPageContainer>
</template>
