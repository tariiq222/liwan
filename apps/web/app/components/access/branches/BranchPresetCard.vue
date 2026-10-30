<script setup lang="ts">
import { BRANCH_PRESETS, type BranchPolicy } from '@webvue/contracts'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { useApplyBranchPreset } from '@/composables/useBranchAccess'

const props = defineProps<{ policy: BranchPolicy; reloadPolicy: () => Promise<BranchPolicy> }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const apply = useApplyBranchPreset()
const { draft, state, save, revert, reload } = useSettingsForm({
  source: () => props.policy,
  read: ({ preset }) => ({ preset: preset === 'custom' ? undefined : preset }),
  save: (values, latest) => apply.mutateAsync({ expected_version: latest.version, preset: values.preset! }),
  reload: () => props.reloadPolicy(),
})
const locked = computed(() => !hydrated.value || state.value.saving || state.value.reloading)
// The management roles the central preset sends into every branch, named so the tenant sees exactly what moves.
const inheritedRoles = computed(() => props.policy.roles
  .filter(role => role.company_id === null && role.active && role.key !== 'employee')
  .map(role => (locale.value === 'ar' ? role.name.ar : role.name.en ?? role.name.ar))
  .join(locale.value === 'ar' ? '، ' : ', '))
const items = computed(() => BRANCH_PRESETS.map(value => ({
  value,
  label: t(`access.branches.presets.${value}`),
  description: value === 'central_branches'
    ? t('access.branches.presets.central_branchesHint', { roles: inheritedRoles.value })
    : t(`access.branches.presets.${value}Hint`),
  disabled: value === 'single_company' && props.policy.branches.length > 0,
})))
</script>

<template>
  <SharedSettingsCard
    id="branch-preset" v-bind="state" :title="t('access.branches.presets.title')" :description="t('access.branches.presets.description')"
    :can-edit="true" :save-label="t('access.branches.presets.apply')" @save="save" @revert="revert" @reload="reload"
  >
    <URadioGroup
      v-model="draft.preset" variant="card" indicator="hidden" :items="items" :disabled="locked"
      :aria-label="t('access.branches.presets.title')" data-testid="branch-preset"
      :ui="{ fieldset: 'grid grid-cols-1 sm:grid-cols-2' }"
    />
    <UAlert v-if="policy.preset === 'custom'" color="neutral" variant="subtle" :title="t('access.branches.presets.custom')" :description="t('access.branches.presets.customHint')" />
    <UAlert v-if="state.dirty" color="warning" variant="subtle" :title="t('access.branches.presets.confirm')" />
  </SharedSettingsCard>
</template>
