<script setup lang="ts">
import { reasonValid, REASON_MAX, type TeamAccount, type TeamRole } from '../../utils/team'

const props = defineProps<{ kind: 'roles' | 'disable' | 'reset', account: TeamAccount, busy?: boolean, errorKey?: string | null }>()
const emit = defineEmits<{ confirm: [reason: string, roles: TeamRole[]], cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()

const reason = ref('')
const reasonField = ref<{ inputRef?: HTMLInputElement | null } | null>(null)
// The panel opens at the reason field: the one thing every action needs.
onMounted(() => nextTick(() => reasonField.value?.inputRef?.focus()))
const roles = ref<TeamRole[]>([...props.account.roles])
const attempted = ref(false)
const reasonError = computed(() => (attempted.value && !reasonValid(reason.value) ? t('team.reason.invalid') : undefined))
const rolesError = computed(() => (attempted.value && !roles.value.length ? t('team.form.rolesInvalid') : undefined))
const name = computed(() => props.account.display_name)

function confirm() {
  attempted.value = true
  if (!hydrated.value || props.busy || !reasonValid(reason.value) || (props.kind === 'roles' && !roles.value.length)) return
  emit('confirm', reason.value.trim(), roles.value)
}
</script>

<template>
  <form v-if="props.kind === 'roles'" class="grid gap-4" novalidate data-slot="account-action" :aria-label="t('team.roleEdit.title', { name })" @submit.prevent="confirm">
    <h2 class="text-base font-semibold text-highlighted">
      {{ t('team.roleEdit.title', { name }) }}
    </h2>
    <UAlert v-if="props.errorKey" role="alert" color="error" variant="subtle" :title="t(props.errorKey)" data-testid="team-error" />
    <TeamRolePicker v-model="roles" :disabled="!hydrated || props.busy" :error="rolesError" />
    <UFormField :label="t('team.reason.label')" :hint="t('team.reason.hint')" :error="reasonError" required>
      <UInput ref="reasonField" v-model="reason" :maxlength="REASON_MAX" class="w-full" :disabled="!hydrated || props.busy" data-testid="action-reason" />
    </UFormField>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || props.busy" :label="t('team.roleEdit.cancel')" @click="emit('cancel')" />
      <UButton type="submit" :loading="props.busy" :disabled="!hydrated" :label="t('team.roleEdit.save')" data-testid="action-submit" />
    </div>
  </form>

  <div v-else class="grid gap-3" data-slot="account-action">
    <UAlert v-if="props.errorKey" role="alert" color="error" variant="subtle" :title="t(props.errorKey)" data-testid="team-error" />
    <SharedInlineConfirm
      :title="t(`team.${props.kind}.title`, { name })"
      :description="t(`team.${props.kind}.description`)"
      :confirm-label="t(`team.${props.kind}.confirm`)"
      :pending="props.busy"
      :color="props.kind === 'disable' ? 'error' : 'warning'"
      @confirm="confirm"
      @cancel="emit('cancel')"
    >
      <UFormField class="mt-3" :label="t('team.reason.label')" :hint="t('team.reason.hint')" :error="reasonError" required>
        <UInput ref="reasonField" v-model="reason" :maxlength="REASON_MAX" class="w-full" :disabled="!hydrated || props.busy" data-testid="action-reason" />
      </UFormField>
    </SharedInlineConfirm>
  </div>
</template>
