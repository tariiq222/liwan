<script setup lang="ts">
import type { UserBranchAccess } from '@liwan/contracts'
import BranchRoleAssignments from '@/components/access/branches/BranchRoleAssignments.vue'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { useUpdateUserBranchAccess } from '@/composables/useBranchAccess'

const props = defineProps<{ userId: number; access: UserBranchAccess; reloadAccess: () => Promise<UserBranchAccess> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const update = useUpdateUserBranchAccess(() => props.userId)
const { draft, state, save, revert, reload } = useSettingsForm({
  source: () => props.access,
  read: ({ branches }) => ({ branches }),
  save: (values, latest) => update.mutateAsync({
    expected_version: latest.version,
    branches: values.branches.map(({ id, role_ids }) => ({ id, role_ids })),
  }),
  reload: () => props.reloadAccess(),
})
const locked = computed(() => !hydrated.value || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="branch-delegation" v-bind="state" :title="t('access.branches.delegation')" :description="t('access.branches.delegationHint')" :can-edit="true" @save="save" @revert="revert" @reload="reload">
    <BranchRoleAssignments v-model="draft.branches" :roles="access.roles" :disabled="locked" />
    <UAlert v-if="state.dirty" color="warning" variant="subtle" :title="t('access.branches.roleWarning')" />
  </SharedSettingsCard>
</template>
