<script setup lang="ts">
import { TEAM_ROLES, type TeamRole } from '../../utils/team'

const props = defineProps<{ modelValue: TeamRole[], disabled?: boolean, error?: string }>()
const emit = defineEmits<{ 'update:modelValue': [roles: TeamRole[]] }>()
const { t } = useI18n()
const hintId = useId()

function toggle(role: TeamRole, selected: boolean) {
  const next = selected ? [...props.modelValue, role] : props.modelValue.filter(item => item !== role)
  emit('update:modelValue', TEAM_ROLES.filter(item => next.includes(item)))
}
</script>

<template>
  <fieldset class="grid gap-2" :aria-describedby="hintId" data-slot="role-picker">
    <legend class="text-sm font-medium text-highlighted">
      {{ t('team.roles.legend') }}
    </legend>
    <p :id="hintId" class="text-sm" :class="props.error ? 'text-error' : 'text-muted'" :role="props.error ? 'alert' : undefined">
      {{ props.error ?? t('team.roles.hint') }}
    </p>
    <div class="grid gap-2 sm:grid-cols-2">
      <UCheckbox
        v-for="role in TEAM_ROLES"
        :key="role"
        :model-value="props.modelValue.includes(role)"
        :label="t(`team.roles.${role}`)"
        :value="role"
        :disabled="props.disabled"
        :data-role="role"
        @update:model-value="toggle(role, $event === true)"
      />
    </div>
  </fieldset>
</template>
