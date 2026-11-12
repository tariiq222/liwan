<script setup lang="ts">
export type RoleOption = {
  id: number
  name: { ar: string; en: string | null }
  /** Muted lines under the name (what the role is, where it applies). */
  description?: string[]
  /** A line in the warning colour under the description, for a role that needs attention. */
  warning?: string
  /** A role that cannot be newly chosen; an already checked one can still be cleared by the caller's own rule. */
  disabled?: boolean
}

// The roles of one company as checkboxes: the one picker of the access forms (invitation, user roles, membership). The
// result is the checked role ids, in the order they were checked.
const props = defineProps<{ roles: RoleOption[]; modelValue: number[]; legend: string; disabled?: boolean; emptyText?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: number[]] }>()
const { locale } = useI18n()
const label = (role: RoleOption) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar
function toggle(roleId: number, checked: boolean) {
  const next = new Set(props.modelValue)
  if (checked) next.add(roleId)
  else next.delete(roleId)
  emit('update:modelValue', [...next])
}
</script>

<template>
  <fieldset class="grid min-w-0 gap-3" :disabled="props.disabled">
    <legend class="sr-only">{{ props.legend }}</legend>
    <p v-if="!props.roles.length && props.emptyText" class="text-sm text-muted">{{ props.emptyText }}</p>
    <UCheckbox v-for="role in props.roles" :key="role.id" :model-value="props.modelValue.includes(role.id)" :disabled="role.disabled" @update:model-value="toggle(role.id, Boolean($event))">
      <template #label><span class="font-medium">{{ label(role) }}</span></template>
      <template v-if="role.description?.length || role.warning" #description>
        <span v-for="line in role.description" :key="line" class="block text-xs text-muted">{{ line }}</span>
        <span v-if="role.warning" class="block text-xs text-warning">{{ role.warning }}</span>
      </template>
    </UCheckbox>
  </fieldset>
</template>
