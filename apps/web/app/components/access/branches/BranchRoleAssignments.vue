<script setup lang="ts">
export type BranchRoleRow = { id: number; name: string; inherit?: boolean; role_ids: number[] }
type Role = { id: number; key: string; name: { ar: string; en: string | null }; company_id?: number | null; active?: boolean }
const props = defineProps<{ modelValue: BranchRoleRow[]; roles: Role[]; inherited?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: BranchRoleRow[]] }>()
const { t, locale } = useI18n()
const availableRoles = (branch: BranchRoleRow) => props.roles.filter(role => role.company_id == null || role.company_id === branch.id)
function change(branchId: number, patch: Partial<Pick<BranchRoleRow, 'inherit' | 'role_ids'>>) {
  emit('update:modelValue', props.modelValue.map(branch => branch.id === branchId ? { ...branch, ...patch } : branch))
}
function toggleRole(branch: BranchRoleRow, roleId: number, enabled: boolean) {
  const ids = new Set(branch.role_ids)
  if (enabled) ids.add(roleId)
  else ids.delete(roleId)
  change(branch.id, { role_ids: [...ids].sort((a, b) => a - b) })
}
</script>

<template>
  <div class="grid gap-(--webvue-gap-card)">
    <SharedEmptyState v-if="!modelValue.length" compact :title="t('access.branches.empty')" />
    <SharedFormSection v-for="branch in modelValue" :key="branch.id" panel :title="branch.name">
      <UCheckbox v-if="inherited" :model-value="branch.inherit" :disabled="disabled" :label="t('access.branches.inherit')" @update:model-value="change(branch.id, { inherit: Boolean($event) })" />
      <fieldset :disabled="disabled || (inherited && !branch.inherit)" class="grid gap-3">
        <legend class="sr-only">{{ branch.name }}</legend>
        <p v-if="!availableRoles(branch).length" class="text-sm text-muted">{{ t('access.branches.rolesEmpty') }}</p>
        <UCheckbox v-for="role in availableRoles(branch)" :key="role.id" :model-value="branch.role_ids.includes(role.id)" :disabled="disabled || (inherited && !branch.inherit) || (role.active === false && !branch.role_ids.includes(role.id))" :description="role.active === false ? t('access.roles.disabledExistingAssignments') : undefined" :label="role.name[locale === 'ar' ? 'ar' : 'en'] ?? role.name.ar" @update:model-value="toggleRole(branch, role.id, Boolean($event))" />
      </fieldset>
    </SharedFormSection>
  </div>
</template>
