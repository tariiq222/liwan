<script setup lang="ts">
import type { BranchPolicy } from '@webvue/contracts'
import BranchRoleAssignments from '@/components/access/branches/BranchRoleAssignments.vue'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { useUpdateBranchPolicy } from '@/composables/useBranchAccess'

const props = defineProps<{ policy: BranchPolicy; reloadPolicy: () => Promise<BranchPolicy> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const update = useUpdateBranchPolicy()
const { draft, state, save, revert, reload } = useSettingsForm({
  source: () => props.policy,
  read: ({ mode, branches }) => ({ mode, branches }),
  save: (values, latest) => update.mutateAsync({
    expected_version: latest.version,
    mode: values.mode,
    branches: values.branches.map(({ id, inherit, role_ids }) => ({ id, inherit: !!inherit, role_ids })),
  }),
  reload: () => props.reloadPolicy(),
})
const locked = computed(() => !hydrated.value || state.value.saving || state.value.reloading)
const modeItems = computed(() => ['isolated', 'delegated', 'inherited'].map(value => ({ value, label: t(`access.branches.${value}`) })))
</script>

<template>
  <SharedSettingsCard id="branch-policy" v-bind="state" :title="t('access.branches.title')" :description="t('access.branches.description')" :can-edit="true" @save="save" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('access.branches.mode')" name="branch-mode" :description="t(`access.branches.${draft.mode}Hint`)">
      <USelect v-model="draft.mode" :items="modeItems" class="w-full" :disabled="locked" />
    </UFormField>
    <template v-if="draft.mode === 'inherited'">
      <fieldset class="grid min-w-0 gap-3">
        <legend class="mb-1 text-sm font-medium text-highlighted">{{ t('access.branches.branchRoles') }}</legend>
        <BranchRoleAssignments v-model="draft.branches" :roles="policy.roles" inherited :disabled="locked" />
      </fieldset>
      <UAlert v-if="state.dirty" color="warning" variant="subtle" :title="t('access.branches.roleWarning')" />
    </template>
  </SharedSettingsCard>
</template>
