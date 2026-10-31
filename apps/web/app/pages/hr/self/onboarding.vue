<script setup lang="ts">
definePageMeta({ path: '/account/onboarding' })
import type { TableColumn } from '@nuxt/ui'
import type { HrOwnOnboardingStep } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { formatDate } from '@liwan/ui/app/utils/formatDate'

// The onboarding steps assigned to the caller: the employee sees their own tasks and marks each one done.
const { t } = useI18n()
const hydrated = useHydrated()
const profile = useMyHrProfile()
const steps = useMyHrOnboardingSteps(computed(() => !!profile.data.value))
const complete = useCompleteMyHrOnboardingStep()
const items = computed(() => steps.data.value?.items ?? [])
const showEmpty = computed(() => !steps.isLoading.value && !steps.error.value && items.value.length === 0)
const actionError = ref('')
const pendingId = ref<number | null>(null)

const columns = computed<TableColumn<HrOwnOnboardingStep>[]>(() => [
  { id: 'summary', header: t('hr.self.onboardingColumns.summary') },
  { id: 'date_deadline', header: t('hr.self.onboardingColumns.deadline') },
  { id: 'action', header: '' },
])
const stateTone = (state: HrOwnOnboardingStep['state']) => (state === 'overdue' ? 'error' : state === 'today' ? 'warning' : 'neutral')

async function finish(step: HrOwnOnboardingStep) {
  if (!hydrated.value || complete.isPending.value) return
  actionError.value = ''
  pendingId.value = step.id
  try {
    await complete.mutateAsync(step.id)
  } catch (cause) {
    actionError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  } finally { pendingId.value = null }
}
</script>

<template>
  <SharedListPage :title="t('hr.self.onboarding')">
    <SharedPageState :loading="profile.isLoading.value" :error="profile.error.value" @retry="profile.refetch">
      <SharedEmptyState v-if="profile.data.value === null" bordered :title="t('hr.self.noEmployee')" :description="t('hr.self.noEmployeeHint')" />
    </SharedPageState>
    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" data-testid="hr-onboarding-mine-error" />
    <SharedListCard v-if="profile.data.value">
      <SharedPageState :error="steps.error.value" :keep-content="items.length > 0" @retry="steps.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t('hr.self.onboardingEmptyTitle')" :description="t('hr.self.onboardingEmptyHint')" />
        <SharedDataTable v-else bare :rows="items" :columns="columns" row-key="id" :loading="steps.isLoading.value" :caption="t('hr.self.onboarding')" data-testid="hr-onboarding-mine-table">
          <template #summary-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.summary }}</span></template>
          <template #date_deadline-cell="{ row }">
            <SharedStatusBadge size="sm" :tone="stateTone(row.original.state)" :label="formatDate(row.original.date_deadline)" />
          </template>
          <template #action-cell="{ row }">
            <UButton size="sm" color="primary" variant="outline" :disabled="!hydrated || complete.isPending.value" :loading="pendingId === row.original.id" :label="t('hr.self.onboardingDone')" data-testid="hr-onboarding-mine-done" @click="finish(row.original)" />
          </template>
          <template #mobile-row="{ row }">
            <p class="font-semibold text-highlighted">{{ row.summary }}</p>
            <p class="mt-1 text-sm text-muted">{{ formatDate(row.date_deadline) }}</p>
            <UButton class="mt-2" size="sm" color="primary" variant="outline" :disabled="!hydrated || complete.isPending.value" :loading="pendingId === row.id" :label="t('hr.self.onboardingDone')" @click="finish(row)" />
          </template>
        </SharedDataTable>
      </SharedPageState>
    </SharedListCard>
  </SharedListPage>
</template>
