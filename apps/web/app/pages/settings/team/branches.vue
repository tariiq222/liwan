<script setup lang="ts">
import BranchPolicyCard from '@/components/access/branches/BranchPolicyCard.vue'
import { useBranchPolicy } from '@/composables/useBranchAccess'

const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const identity = computed(() => me.value ? `${me.value.id}:${me.value.company.id}` : null)
const forbidden = computed(() => !can('access.users.assign_roles') || !can('access.roles.read'))
const query = useBranchPolicy(computed(() => !forbidden.value))
async function reloadPolicy() {
  const result = await query.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('access.branches.title')" back-to="/settings/team" />
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <!-- Keyed by the signed-in user and company, so a draft never outlives the identity it was made for. -->
      <BranchPolicyCard v-if="query.data.value" :key="identity ?? ''" :policy="query.data.value" :reload-policy="reloadPolicy" />
    </SharedPageState>
  </SharedSettingsPage>
</template>
