<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { accessBadge, invitationStatus } from '@/components/access/accessBadge'
import { accessErrorMessage } from '@/utils/accessErrors'
import { adminUserMutationKey, useSetAdminUserSeat } from '@/composables/useAdminUsers'
import { MAX_SEAT_PRIORITY } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { useIsMutating } from '@tanstack/vue-query'
import CapabilityGroups from '@/components/access/users/CapabilityGroups.vue'
import { adminListQuery } from '@/composables/adminSettingsPaths'
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const actorScope = computed(() => me.value ? `${me.value.id}:${me.value.company.id}` : null)
const hydrated = useHydrated()
const id = computed(() => Number(route.params.userId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const sourcePaths = useRecordListPaths(['/settings/team/users'])
const returnTo = computed(() => router.resolve(owningListBack({ ...adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset']), returnTo: route.query.returnTo ?? null }, sourcePaths.value, route.hash)).fullPath)
const accessTo = computed(() => recordChildTo(`/settings/team/users/${id.value}/access`, route.query, sourcePaths.value, route.hash))
const securityTo = computed(() => recordChildTo(`/settings/team/users/${id.value}/security`, route.query, sourcePaths.value, route.hash))
const forbidden = computed(() => !can('access.users.read'))
const query = useAdminUser(computed(() => validId.value ? id.value : null), computed(() => !forbidden.value))
const pageError = computed(() => query.error.value ?? (validId.value || forbidden.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value && can('access.roles.read')))
const badge = computed(() => accessBadge({ active: query.data.value?.active ?? false, protected: query.data.value?.protected, invitation: query.data.value?.invitation }))
// The pending invitation: its state and the three things an administrator can do about it. Resend and a corrected
// email each revoke the old link at once; cancelling archives the account and frees its seat.
const resendInvitation = useResendAdminUserInvitation()
const changeInvitationLogin = useChangeAdminUserInvitationLogin()
const cancelInvitation = useCancelAdminUserInvitation()
const mutating = useIsMutating({ mutationKey: adminUserMutationKey })
const setSeat = useSetAdminUserSeat()
const seatEditable = computed(() => me.value?.read_only === false && query.data.value?.allowed_actions.includes('set_seat'))
const seatDraft = ref<{ id: number; version: string; originalReadOnly: boolean; originalPriority: number; actorScope: string | null } | null>(null)
const draftReadOnly = ref(false)
const draftPriority = ref<number | undefined>(0)
const seatError = ref('')
const priorityValid = computed(() => draftPriority.value !== undefined && Number.isInteger(draftPriority.value) && draftPriority.value >= 0 && draftPriority.value <= MAX_SEAT_PRIORITY)
const seatDirty = computed(() => !!seatDraft.value && (
  draftReadOnly.value !== seatDraft.value.originalReadOnly || draftPriority.value !== seatDraft.value.originalPriority
))
function startSeatEdit() {
  const user = query.data.value
  if (!user || !seatEditable.value || !hydrated.value) return
  seatError.value = ''
  seatDraft.value = { id: user.id, version: user.version, originalReadOnly: user.read_only, originalPriority: user.seat_priority, actorScope: actorScope.value }
  draftReadOnly.value = user.read_only
  draftPriority.value = user.seat_priority
}
async function saveSeat() {
  const draft = seatDraft.value
  const priority = draftPriority.value
  if (!draft || draft.id !== id.value || draft.actorScope !== actorScope.value || !seatEditable.value || !hydrated.value || mutating.value || !seatDirty.value || !priorityValid.value || priority === undefined) return
  seatError.value = ''
  try {
    await setSeat.mutateAsync({ id: draft.id, body: {
      expected_version: draft.version,
      ...(draftReadOnly.value !== draft.originalReadOnly ? { read_only: draftReadOnly.value } : {}),
      ...(priority !== draft.originalPriority ? { priority } : {}),
    } })
    if (seatDraft.value === draft) seatDraft.value = null
  } catch (error) {
    if (seatDraft.value === draft) seatError.value = accessErrorMessage(error, t)
  }
}
const invitation = computed(() => invitationStatus(query.data.value?.invitation))
const canInvite = (action: 'resend_invitation' | 'edit_invitation' | 'cancel_invitation') => !!query.data.value && !query.data.value.protected && (query.data.value.allowed_actions as string[]).includes(action)
const editingLogin = ref(false)
const confirmingCancel = ref(false)
const loginDraft = ref('')
const loginDraftInvalid = computed(() => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginDraft.value.trim()))
const invitationSuccess = ref('')
const invitationError = ref('')
watch([id, actorScope], () => {
  editingLogin.value = false
  confirmingCancel.value = false
  invitationSuccess.value = ''
  invitationError.value = ''
  seatDraft.value = null
  seatError.value = ''
})
async function runInvitation(action: () => Promise<unknown>, success: string) {
  invitationError.value = ''
  invitationSuccess.value = ''
  try {
    await action()
    invitationSuccess.value = success
  } catch (error) {
    invitationError.value = accessErrorMessage(error, t)
  }
}
function invitationBody() {
  const user = query.data.value!
  return { id: user.id, body: { expected_version: user.version } }
}
const resend = () => runInvitation(() => resendInvitation.mutateAsync(invitationBody()), t('access.users.invitationResent', { email: query.data.value?.login }))
async function saveInvitationLogin() {
  const user = query.data.value
  if (!user || loginDraftInvalid.value) return
  const email = loginDraft.value.trim()
  await runInvitation(() => changeInvitationLogin.mutateAsync({ id: user.id, body: { login: email, expected_version: user.version } }), t('access.users.invitationLoginChanged', { email }))
  if (!invitationError.value) editingLogin.value = false
}
async function cancel() {
  confirmingCancel.value = false
  await runInvitation(() => cancelInvitation.mutateAsync(invitationBody()), t('access.users.invitationCancelled'))
}
function startEditingLogin() {
  loginDraft.value = query.data.value?.login ?? ''
  confirmingCancel.value = false
  editingLogin.value = true
}
const tabs = computed(() => {
  const user = query.data.value
  const actions = user?.allowed_actions ?? []
  return [
    { key: 'user-tab-account', label: t('access.users.account'), to: { path: route.path, query: route.query, hash: '' }, active: true },
    ...(actions.includes('assign_roles') ? [{ key: 'user-tab-access', label: t('access.users.editAccess'), to: accessTo.value, active: false }] : []),
    ...(actions.includes('send_reset_link') || actions.includes('disable') || actions.includes('reactivate')
      ? [{ key: 'user-tab-security', label: t('access.users.security'), to: securityTo.value, active: false }] : []),
    ...(can('access.audit.read') ? [{ key: 'user-tab-changes', label: t('access.users.changes'), to: `/settings/team/access-log?target_type=user&target_id=${id.value}`, active: false }] : []),
    ...(user?.employee && can('hr.employees.read') ? [{ key: 'user-tab-employee', label: t('access.users.employeeFile'), to: `/hr/employees/${user.employee.id}`, active: false }] : []),
  ]
})
</script>

<template>
  <SharedRecordPage :keep-content="!!query.data.value"
    data-testid="settings-layout"
    :title="query.data.value?.name ?? t('access.users.title')"
    :back-to="returnTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template #tabs><SharedRouteTabs :items="tabs" :ariaLabel="t('access.users.accountNavigation')" /></template>
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <SharedPageState v-else :empty="!query.data.value" :empty-text="t('access.notFound')">
      <template v-if="query.data.value">
        <SharedIdentityCard :id="query.data.value.id" :name="query.data.value.name">
          <template #badge><SharedStatusBadge size="sm" :tone="badge.tone" :label="t(badge.labelKey)" :icon="badge.icon" /></template>
          <template #subtitle><bdi dir="ltr">{{ query.data.value.login }}</bdi><template v-if="query.data.value.employee !== undefined"> · {{ query.data.value.employee?.name ?? t('access.users.noEmployee') }}</template></template>
        </SharedIdentityCard>
        <SharedRecordSection v-if="query.data.value.active && !query.data.value.protected && !invitation" id="seat" variant="panel" :title="t('access.seats.userTitle')">
          <SharedPropertiesPanel>
            <SharedPropertyRow :label="t('access.seats.state')" :value="t(query.data.value.read_only ? 'access.seats.readOnly' : 'access.seats.full')" />
            <SharedPropertyRow :label="t('access.seats.priority')" :value="query.data.value.seat_priority || null" />
          </SharedPropertiesPanel>
          <UButton v-if="seatEditable && !seatDraft" class="mt-3" color="neutral" variant="outline" :disabled="!hydrated || mutating > 0" @click="startSeatEdit">{{ t('access.seats.edit') }}</UButton>
          <form v-if="seatEditable && seatDraft" class="mt-3 grid gap-(--liwan-gap-card)" @submit.prevent="saveSeat">
            <UCheckbox v-model="draftReadOnly" :label="t('access.seats.markReadOnly')" :description="t('access.seats.userReadOnlyHint')" :disabled="!hydrated || mutating > 0" />
            <UFormField :label="t('access.seats.priority')" :help="t('access.seats.priorityHint')" :error="priorityValid ? undefined : t('access.seats.priorityInvalid')" name="seat-priority">
              <UInputNumber v-model="draftPriority" :min="0" :max="MAX_SEAT_PRIORITY" :disabled="!hydrated || mutating > 0" />
            </UFormField>
            <UAlert v-if="seatError" role="alert" color="error" variant="subtle" :title="seatError" />
            <SharedFormActions>
              <UButton type="submit" :loading="setSeat.isPending.value" :disabled="!hydrated || mutating > 0 || !seatDirty || !priorityValid">{{ t('access.seats.save') }}</UButton>
              <UButton type="button" color="neutral" variant="outline" :disabled="mutating > 0" @click="seatDraft = null">{{ t('app.cancel') }}</UButton>
            </SharedFormActions>
          </form>
          <SharedUnsavedChanges :dirty="seatDirty" />
        </SharedRecordSection>
        <SharedRecordSection v-if="invitation || invitationSuccess" id="invitation" variant="panel" :title="t('access.users.invitation')">
          <div class="grid gap-4">
            <template v-if="invitation && query.data.value.invitation">
              <p class="text-sm text-muted">{{ t(`access.users.invitationHint.${invitation}`) }}</p>
              <dl class="divide-y divide-default">
                <SharedPropertyRow :label="t('access.users.invitationSentAt')" :value="query.data.value.invitation.sent_at ? formatDateTime(query.data.value.invitation.sent_at) : null" />
                <SharedPropertyRow :label="t('access.users.invitationExpiresAt')" :value="query.data.value.invitation.expires_at ? formatDateTime(query.data.value.invitation.expires_at) : null" />
              </dl>
              <div class="flex flex-wrap items-center gap-2">
                <UButton v-if="canInvite('resend_invitation')" color="primary" variant="outline" icon="i-lucide-send" :disabled="!hydrated || mutating > 0 || editingLogin || confirmingCancel" :label="t('access.users.resendInvitation')" @click="resend" />
                <UButton v-if="canInvite('edit_invitation')" color="neutral" variant="outline" icon="i-lucide-pencil" :disabled="!hydrated || mutating > 0 || editingLogin || confirmingCancel" :label="t('access.users.editInvitation')" @click="startEditingLogin" />
                <UButton v-if="canInvite('cancel_invitation')" color="neutral" variant="outline" icon="i-lucide-x" :disabled="!hydrated || mutating > 0 || editingLogin || confirmingCancel" :label="t('access.users.cancelInvitation')" @click="confirmingCancel = true" />
              </div>
              <form v-if="editingLogin" class="liwan-form" novalidate @submit.prevent="saveInvitationLogin">
                <UFormField :label="t('access.users.loginEmail')" name="invitation-login" :error="loginDraft.trim() && loginDraftInvalid ? t('access.users.loginInvalid') : undefined">
                  <UInput id="invitation-login" v-model="loginDraft" type="email" autocomplete="off" dir="ltr" class="w-full" :disabled="mutating > 0" />
                </UFormField>
                <div class="flex flex-wrap justify-end gap-2">
                  <UButton type="button" color="neutral" variant="outline" :disabled="mutating > 0" :label="t('app.cancel')" @click="editingLogin = false" />
                  <UButton type="submit" color="primary" :loading="changeInvitationLogin.isPending.value" :disabled="mutating > 0 || loginDraftInvalid || loginDraft.trim() === query.data.value.login" :label="t('access.users.saveInvitationLogin')" />
                </div>
              </form>
              <SharedInlineConfirm v-if="confirmingCancel" color="warning" :title="t('access.users.confirmCancelInvitation', { name: query.data.value.name })" :confirm-label="t('access.users.cancelInvitation')" :pending="mutating > 0" @confirm="cancel" @cancel="confirmingCancel = false" />
            </template>
            <UAlert v-if="invitationSuccess" role="status" color="success" variant="subtle" icon="i-lucide-circle-check" :title="invitationSuccess" />
            <UAlert v-if="invitationError" role="alert" color="error" variant="subtle" :title="invitationError" />
          </div>
        </SharedRecordSection>
        <SharedRecordSection id="roles" variant="panel" :title="t('access.users.rolesAndScopes')">
          <ul v-if="query.data.value.assignments.length" class="grid gap-2">
            <SharedSubCard v-for="assignment in query.data.value.assignments" :key="assignment.id" as="li" class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-semibold text-highlighted">{{ assignment.role.name[locale === 'ar' ? 'ar' : 'en'] ?? assignment.role.name.ar }}</span>
              <SharedStatusBadge tone="neutral" size="sm" :label="assignment.scope.name" />
            </SharedSubCard>
          </ul>
          <p v-else class="text-sm text-muted">{{ t('access.users.noRoles') }}</p>
        </SharedRecordSection>
        <SharedRecordSection id="capabilities" variant="panel" :title="t('access.users.capabilities')">
          <CapabilityGroups :capabilities="query.data.value.capabilities" :permissions="catalog.data.value?.items" />
        </SharedRecordSection>
      </template>
    </SharedPageState>
    <template v-if="query.data.value && !forbidden" #aside>
      <SharedPropertiesPanel id="account" :title="t('access.users.account')">
        <SharedPropertyRow :label="t('access.users.loginName')"><bdi dir="ltr">{{ query.data.value.login }}</bdi></SharedPropertyRow>
        <SharedPropertyRow :label="t('access.users.mobile')">
          <bdi v-if="query.data.value.mobile" dir="ltr">{{ query.data.value.mobile }}</bdi>
          <span v-else class="text-muted">{{ t('access.users.noMobile') }}</span>
        </SharedPropertyRow>
        <SharedPropertyRow v-if="query.data.value.employee !== undefined" :label="t('access.users.employee')" :value="query.data.value.employee?.name ?? t('access.users.noEmployee')" />
        <SharedPropertyRow :label="t('access.users.columns.status')">
          <SharedStatusBadge size="sm" :tone="badge.tone" :label="t(badge.labelKey)" :icon="badge.icon" />
        </SharedPropertyRow>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
