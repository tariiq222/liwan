<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { OperationProcessSchema, type OperationProcessBody } from '@liwan/contracts'
import ProcessForm from '@/components/operations/ProcessForm.vue'
import { hrLeaveKeys } from '@/composables/useHrLeave'

const editor = '/api/v1/hr/leave/approval-process/editor'
const backTo = '/settings/apps/hr?area=leave'
const { $api } = useApi()
const { t } = useI18n()
const cache = useQueryClient()
const { me } = useMe()
const company = computed(() => me.value?.company.id ?? null)
const loadedCompany = ref<number | null>(null)
const process = useQuery({
  queryKey: computed(() => [...hrLeaveKeys.approvalProcess, 'editor', company.value]),
  enabled: computed(() => company.value !== null),
  queryFn: async () => {
    const expected = company.value
    const result = await $api(editor, { schema: OperationProcessSchema })
    if (expected === company.value) loadedCompany.value = expected
    return result
  },
})

async function refresh() {
  const result = await process.refetch({ throwOnError: true })
  if (!result.data) throw new Error('Leave approval process unavailable')
  return result.data
}

async function save(body: OperationProcessBody) {
  if (loadedCompany.value === null || loadedCompany.value !== company.value) throw new ApiError(409, 'conflict', t('errors.generic'))
  const saved = await $api(editor, {
    method: 'PATCH',
    body: {
      process_id: process.data.value?.id, revision: body.revision,
      name: body.name, description: body.description, steps: body.steps,
      stage_approval_mode: body.stage_approval_mode,
    },
    schema: OperationProcessSchema,
  })
  await cache.invalidateQueries({ queryKey: hrLeaveKeys.approvalProcess })
  return saved
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('hr.leaveApproval.edit')" :back-to="backTo" />
    <SharedPageState :loading="process.isPending.value" :error="process.error.value" @retry="process.refetch()">
      <ProcessForm v-if="process.data.value" :key="process.data.value.id" :process="process.data.value"
        :locked-kind="{ key: 'hr_leave', label: t('hr.leaveApproval.title') }"
        :resolvers-path="`${editor}/resolvers`" :back-to="backTo" :save="save" :refresh="refresh"
        @saved="navigateTo(backTo)" />
    </SharedPageState>
  </SharedPageContainer>
</template>
