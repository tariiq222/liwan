<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { useHrLeaveAllocation } from '@/composables/useHrLeave'
import { useHrLeaveFormat } from '@/composables/useHrLeaveFormat'
import { hrLeaveBadge } from '@/utils/hrLeaveBadge'
import LeaveAllocationForm from '@/components/hr/LeaveAllocationForm.vue'

// One granted leave balance. Its days and validity are corrected in place (the /new panel is
// the only create route); the employee and the leave type identify the grant and stay as they are.
// The server refuses an edit of one's own grant (403), of a refused one and one below the days
// already taken (422); the form shows those messages.
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const { validity, days } = useHrLeaveFormat()

const id = computed(() => Number(route.params.allocationId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const query = useHrLeaveAllocation(computed(() => validId.value ? id.value : null))
const allocation = computed(() => query.data.value ?? null)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const sourcePaths = useRecordListPaths(['/hr/leave/allocations'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const editable = computed(() => !!allocation.value && allocation.value.state !== 'refuse')

const editing = ref(false)

async function onSaved() {
  editing.value = false
  await query.refetch()
}
</script>

<template>
  <SharedForbiddenState v-if="!can('hr.leave.manage')" />
  <SharedRecordPage
    v-else
    :title="allocation ? t('hr.leave.allocation.recordTitle', { type: allocation.leave_type.name }) : t('hr.leave.allocation.listTitle')"
    :back-to="backTo"
    :back-label="t('hr.leave.allocation.listTitle')"
    :loading="query.isLoading.value"
    :error="pageError"
    :keep-content="!!allocation"
    @retry="query.refetch"
  >
    <template v-if="editable" #actions>
      <UButton
        v-if="!editing"
        color="neutral"
        variant="outline"
        icon="i-lucide-pencil"
        :disabled="!hydrated"
        :label="t('hr.leave.allocation.edit')"
        data-testid="hr-allocation-edit"
        @click="editing = true"
      />
      <UButton
        v-else
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        :label="t('app.cancel')"
        data-testid="hr-allocation-cancel"
        @click="editing = false"
      />
    </template>

    <template v-if="allocation && editing">
      <LeaveAllocationForm :allocation="allocation" :back-to="backTo" @saved="onSaved" />
    </template>

    <template v-else-if="allocation">
      <SharedIdentityCard :id="allocation.id" :name="allocation.employee.name" :subtitle="allocation.leave_type.name">
        <template #badge>
          <SharedStatusBadge size="sm" :tone="hrLeaveBadge(allocation.state).tone" :label="t(hrLeaveBadge(allocation.state).labelKey)" />
        </template>
      </SharedIdentityCard>
    </template>

    <template v-if="allocation" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hr.leave.allocation.days')"><span class="tabular-nums">{{ days(allocation.number_of_days) }}</span></SharedPropertyRow>
        <SharedPropertyRow :label="t('hr.leave.allocation.validity')"><bdi class="tabular-nums">{{ validity(allocation) }}</bdi></SharedPropertyRow>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
