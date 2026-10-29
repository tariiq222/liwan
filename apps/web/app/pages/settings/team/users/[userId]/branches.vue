<script setup lang="ts">
import UserBranchAccessCard from '@/components/access/branches/UserBranchAccessCard.vue'
import { ApiError } from '@/composables/useApi'
import { useBranchPolicy, useUserBranchAccess } from '@/composables/useBranchAccess'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const identity = computed(() => me.value ? `${me.value.id}:${me.value.company.id}` : null)
const id = computed(() => Number(route.params.userId))
const valid = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const forbidden = computed(() => !can('access.users.assign_roles') || !can('access.roles.read'))
const policy = useBranchPolicy(computed(() => !forbidden.value))
const query = useUserBranchAccess(id, computed(() => !forbidden.value && valid.value))
const pageError = computed(() => valid.value ? query.error.value : new ApiError(404, 'not_found', t('access.notFound')))
async function reloadAccess() {
  const result = await query.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('access.branches.delegation')" :back-to="`/settings/team/users/${id}/access`" />
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value" :error="pageError" @retry="query.refetch">
      <template v-if="query.data.value && !pageError">
        <p v-if="policy.data.value" class="text-sm text-muted">{{ t(`access.branches.${policy.data.value.mode}Hint`) }}</p>
        <UButton to="/settings/team/branches" color="neutral" variant="link" :label="t('access.branches.policyLink')" />
        <!-- Keyed by identity and user, so a draft never outlives the person or the account it was made for. -->
        <UserBranchAccessCard :key="`${identity}:${id}`" :user-id="id" :access="query.data.value" :reload-access="reloadAccess" />
      </template>
    </SharedPageState>
  </SharedSettingsPage>
</template>
