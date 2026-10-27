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

// Edit mode lives in the address (`?edit=1`): leaving it is a navigation, so the form's
// unsaved-changes guard asks before a draft is dropped, and a refresh keeps the form open.
const router = useRouter()
const editing = computed(() => route.query.edit === '1' && editable.value)
const viewTo = computed(() => {
  const { edit: _edit, ...query } = route.query
  return { path: route.path, query, ...(route.hash ? { hash: route.hash } : {}) }
})
function startEditing() {
  if (!hydrated.value) return
  void router.push({ path: route.path, query: { ...route.query, edit: '1' }, ...(route.hash ? { hash: route.hash } : {}) })
}

async function onSaved() {
  await router.replace(viewTo.value)
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
        @click="startEditing"
      />
      <UButton
        v-else
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        :label="t('app.cancel')"
        :to="viewTo"
        data-testid="hr-allocation-cancel"
      />
    </template>

    <template v-if="allocation && editing">
      <LeaveAllocationForm :allocation="allocation" :back-to="viewTo" @saved="onSaved" />
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
