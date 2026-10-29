<script setup lang="ts">
import BranchPolicyCard from '@/components/access/branches/BranchPolicyCard.vue'
import { ApiError } from '@/composables/useApi'
import { useBranchPolicy } from '@/composables/useBranchAccess'
import { useCreateBranch } from '@/composables/useCreateBranch'

const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const identity = computed(() => me.value ? `${me.value.id}:${me.value.company.id}` : null)
const canCreate = computed(() => can('settings.company.manage'))
const hydrated = useHydrated()
const create = useCreateBranch()
const branchName = ref('')
const createFailure = ref('')
const created = ref(false)
const canSubmit = computed(() => hydrated.value && !create.isPending.value && branchName.value.trim().length > 0)
async function submitBranch() {
  if (!canSubmit.value) return
  createFailure.value = ''
  created.value = false
  try {
    await create.mutateAsync({ name: branchName.value })
    branchName.value = ''
    created.value = true
  } catch (error) {
    createFailure.value = error instanceof ApiError ? error.message : t('errors.generic')
  }
}
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
    <SharedRecordSection v-if="canCreate" variant="panel" data-testid="branch-create" :title="t('access.branches.create.title')" :description="t('access.branches.create.description')">
      <form class="grid gap-4" @submit.prevent="submitBranch">
        <UFormField :label="t('access.branches.create.name')" name="branch-name">
          <UInput v-model="branchName" maxlength="200" class="w-full" :disabled="!hydrated || create.isPending.value" />
        </UFormField>
        <UAlert v-if="createFailure" color="error" variant="subtle" :title="createFailure">
          <template #actions><UButton to="/subscription/branches" color="neutral" variant="outline" size="sm">{{ t('access.branches.create.subscription') }}</UButton></template>
        </UAlert>
        <p v-else-if="created" role="status" class="text-sm text-muted">{{ t('access.branches.create.done') }}</p>
        <div><UButton type="submit" icon="i-lucide-plus" :loading="create.isPending.value" :disabled="!canSubmit">{{ t('access.branches.create.action') }}</UButton></div>
      </form>
    </SharedRecordSection>
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <!-- Keyed by the signed-in user and company, so a draft never outlives the identity it was made for. -->
      <BranchPolicyCard v-if="query.data.value" :key="identity ?? ''" :policy="query.data.value" :reload-policy="reloadPolicy" />
    </SharedPageState>
  </SharedSettingsPage>
</template>
