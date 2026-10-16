<script setup lang="ts">
import { reasonValid, REASON_MAX, type TeamRole } from '../../utils/team'
import type { InviteDraft } from '../../composables/useTeamActions'

const props = defineProps<{ busy?: boolean, errorKey?: string | null }>()
const emit = defineEmits<{ submit: [draft: InviteDraft], cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()

const draft = reactive<{ email: string, displayName: string, roles: TeamRole[], reason: string }>({ email: '', displayName: '', roles: [], reason: '' })
const attempted = ref(false)
const dirty = computed(() => Boolean(draft.email || draft.displayName || draft.roles.length || draft.reason))
const errors = computed(() => ({
  email: /^[^@\s]+@[^@\s]+$/.test(draft.email.trim()) && draft.email.trim().length <= 254 ? undefined : t('team.form.emailInvalid'),
  displayName: draft.displayName.trim().length >= 1 && draft.displayName.trim().length <= 120 ? undefined : t('team.form.nameInvalid'),
  roles: draft.roles.length ? undefined : t('team.form.rolesInvalid'),
  reason: reasonValid(draft.reason) ? undefined : t('team.reason.invalid'),
}))
const show = <K extends keyof typeof errors.value>(field: K) => (attempted.value ? errors.value[field] : undefined)

function submit() {
  attempted.value = true
  if (!hydrated.value || props.busy || Object.values(errors.value).some(Boolean)) return
  emit('submit', { email: draft.email.trim(), displayName: draft.displayName.trim(), roles: [...draft.roles], reason: draft.reason.trim() })
}
</script>

<template>
  <form class="grid gap-4" novalidate data-slot="account-form" :aria-label="t('team.form.title')" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" guard-route-updates />
    <UAlert v-if="props.errorKey" role="alert" color="error" variant="subtle" :title="t(props.errorKey)" data-testid="team-error" />
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('team.form.email')" :error="show('email')" required>
        <UInput v-model="draft.email" type="email" dir="ltr" autocomplete="off" class="w-full" :disabled="!hydrated || props.busy" data-testid="invite-email" />
      </UFormField>
      <UFormField :label="t('team.form.name')" :error="show('displayName')" required>
        <UInput v-model="draft.displayName" autocomplete="off" class="w-full" :disabled="!hydrated || props.busy" data-testid="invite-name" />
      </UFormField>
    </div>
    <TeamRolePicker v-model="draft.roles" :disabled="!hydrated || props.busy" :error="show('roles')" />
    <UFormField :label="t('team.reason.label')" :hint="t('team.reason.hint')" :error="show('reason')" required>
      <UInput v-model="draft.reason" :maxlength="REASON_MAX" class="w-full" :disabled="!hydrated || props.busy" data-testid="invite-reason" />
    </UFormField>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || props.busy" :label="t('team.form.cancel')" @click="emit('cancel')" />
      <UButton type="submit" :loading="props.busy" :disabled="!hydrated" :label="t('team.form.submit')" data-testid="invite-submit" />
    </div>
  </form>
</template>
