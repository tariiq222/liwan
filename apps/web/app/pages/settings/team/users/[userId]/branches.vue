<script setup lang="ts">
import type { UserBranchAccess } from '@webvue/contracts'
import BranchRoleAssignments, { type BranchRoleRow } from '@/components/access/branches/BranchRoleAssignments.vue'
import { ApiError } from '@/composables/useApi'
import { useBranchPolicy, useUserBranchAccess, useUpdateUserBranchAccess } from '@/composables/useBranchAccess'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.userId))
const valid = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const forbidden = computed(() => !can('access.users.assign_roles') || !can('access.roles.read'))
const policy = useBranchPolicy(computed(() => !forbidden.value))
const query = useUserBranchAccess(id, computed(() => !forbidden.value && valid.value))
const update = useUpdateUserBranchAccess(id)
const original = ref<UserBranchAccess | null>(null)
const branches = ref<BranchRoleRow[]>([])
const feedback = ref('')
const saved = ref(false)
const confirmReload = ref(false)
const pageError = computed(() => valid.value ? query.error.value : new ApiError(404, 'not_found', t('access.notFound')))
const dirty = computed(() => original.value !== null && JSON.stringify(branches.value) !== JSON.stringify(original.value.branches))
function accept(value: UserBranchAccess) {
  original.value = value
  branches.value = value.branches.map(branch => ({ ...branch, role_ids: [...branch.role_ids] }))
  feedback.value = ''
  confirmReload.value = false
}
watch(query.data, value => { if (value && !dirty.value) accept(value) }, { immediate: true })
watch(id, () => { original.value = null; branches.value = []; feedback.value = ''; saved.value = false })
async function save() {
  if (!original.value || forbidden.value || !hydrated.value || update.isPending.value) return
  const target = id.value
  feedback.value = ''
  saved.value = false
  try {
    const value = await update.mutateAsync({ expected_version: original.value.version, branches: branches.value.map(({ id, role_ids }) => ({ id, role_ids })) })
    if (target !== id.value) return
    accept(value)
    saved.value = true
  } catch (error) {
    if (target !== id.value) return
    feedback.value = error instanceof ApiError && error.status === 409 ? 'access.errors.conflict' : 'errors.generic'
  }
}
async function reload() {
  const target = id.value
  const result = await query.refetch()
  if (target === id.value && result.data && !result.error) { accept(result.data); saved.value = false }
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('access.branches.delegation')" :back-to="`/settings/team/users/${id}/access`" />
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value" :error="pageError" @retry="query.refetch">
      <form v-if="original && !pageError" class="webvue-form" @submit.prevent="save">
        <SharedUnsavedChanges :dirty="dirty" />
        <p class="text-sm text-muted">{{ t('access.branches.delegationHint') }}</p>
        <p v-if="policy.data.value" class="text-sm text-muted">{{ t(`access.branches.${policy.data.value.mode}Hint`) }}</p>
        <UButton to="/settings/team/branches" color="neutral" variant="link" :label="t('access.branches.policyLink')" />
        <fieldset :disabled="!hydrated || update.isPending.value" class="grid gap-(--webvue-gap-card)">
          <legend class="sr-only">{{ t('access.branches.delegation') }}</legend>
          <BranchRoleAssignments v-model="branches" :roles="original.roles" :disabled="!hydrated || update.isPending.value" />
          <UAlert v-if="dirty" color="warning" variant="subtle" :title="t('access.branches.roleWarning')" />
          <UAlert v-if="saved && !dirty" role="status" color="success" variant="subtle" :title="t('access.branches.saved')" />
          <UAlert v-if="feedback" role="alert" color="error" variant="subtle" :title="t(feedback)" />
          <UAlert v-if="confirmReload" color="warning" variant="subtle" :title="t('access.branches.reloadHint')" :actions="[{ label: t('access.branches.confirmReload'), color: 'neutral', variant: 'outline', onClick: reload }]" />
          <SharedFormActions>
            <UButton v-if="feedback" color="neutral" variant="outline" :label="t('access.branches.reload')" @click="confirmReload = true" />
            <UButton type="submit" :label="t('access.save')" :disabled="!dirty || update.isPending.value" :loading="update.isPending.value" />
          </SharedFormActions>
        </fieldset>
      </form>
    </SharedPageState>
  </SharedSettingsPage>
</template>
