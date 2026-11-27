<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import BranchSeatForm from '@/components/access/branches/BranchSeatForm.vue'
import { useBranchSeats } from '@/composables/useBranchAccess'

// Edits one branch's seat (its read-only state and reopening priority) on its own page.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const identity = computed(() => me.value ? `${me.value.id}:${me.value.company.id}` : null)
const canCreate = computed(() => can('settings.company.manage') && me.value?.read_only === false)
const branchId = computed(() => {
  const raw = typeof route.params.branchId === 'string' ? route.params.branchId : ''
  if (!/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
})
const validId = computed(() => branchId.value !== null)
const branchSeats = useBranchSeats(computed(() => canCreate.value && validId.value))
const branch = computed(() => (branchId.value === null ? null : branchSeats.data.value?.items.find(item => item.id === branchId.value) ?? null))
const pageError = computed(() => {
  if (branchId.value === null) return new ApiError(404, 'not_found', t('access.notFound'))
  if (branchSeats.error.value) return branchSeats.error.value
  if (!branchSeats.isLoading.value && branchSeats.data.value && !branch.value) return new ApiError(404, 'not_found', t('access.notFound'))
  return null
})
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="branch?.name ?? t('access.seats.branchTitle')" back-to="/settings/team/branches#branch-seats" />
    <SharedForbiddenState v-if="!canCreate" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="branchSeats.isLoading.value" :error="pageError" @retry="branchSeats.refetch()">
      <BranchSeatForm v-if="branch" :key="`${identity ?? ''}-${branch.id}`" :branch="branch" :identity="identity" @done="router.replace('/settings/team/branches#branch-seats')" @cancel="router.push('/settings/team/branches#branch-seats')" />
    </SharedPageState>
  </SharedPageContainer>
</template>
