<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { TelephonyRecordListSchema } from '@liwan/contracts'

const { t } = useI18n()
const { $api } = useApi()
const records = useQuery({
  queryKey: ['telephony', 'records'],
  queryFn: () => $api('/api/v1/telephony/records', { schema: TelephonyRecordListSchema }),
})
const items = computed(() => records.data.value?.items ?? [])
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('telephony.title')" />
    <SharedPageState
      :loading="records.isPending.value"
      :error="records.error.value"
      :empty="items.length === 0"
      :empty-text="t('telephony.empty')"
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
