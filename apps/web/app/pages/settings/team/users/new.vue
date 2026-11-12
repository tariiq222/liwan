<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { owningListBack } from '@/utils/recordListOrigin'
import { accessErrorMessage } from '@/utils/accessErrors'
import EmployeeAccountPicker from '@/components/access/users/EmployeeAccountPicker.vue'
import { useAdminUser, useAdminUserSeats, useGrantAdminAccount, useReactivateAdminUser, useUpdateAdminUserAccess } from '@/composables/useAdminUsers'
import { useEmployeeAccountBridge, useGrantEmployeeAccount } from '@/composables/useEmployeeAccounts'
import RoleCheckboxes, { type RoleOption } from '@/components/access/users/RoleCheckboxes.vue'
import ExistingAccountConfirm from '@/components/access/users/ExistingAccountConfirm.vue'
import { useAddMembership } from '@/composables/useMemberships'
import { ExistingAccountDetailsSchema, type EmployeeAccountCandidate, type MembershipCompany } from '@liwan/contracts'
import { useAdminPermissionCatalog, useAdminRoleDetails, useAdminRoles } from '@/composables/useAdminRoles'
import { adminListQuery } from '@/composables/adminSettingsPaths'

const { t, locale } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const { me } = useMe()
const forbidden = computed(() => !can('access.users.grant'))
const route = useRoute()
const router = useRouter()
const sourcePaths = useRecordListPaths(['/settings/team/users'])
const backTo = computed(() => router.resolve(owningListBack({ ...adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset']), returnTo: route.query.returnTo ?? null }, sourcePaths.value, route.hash)).fullPath)
const requestedEmployeeId = Number(route.query.employee_id)
const hasRequestedEmployee = Number.isInteger(requestedEmployeeId) && requestedEmployeeId > 0
const bridge = useEmployeeAccountBridge()
// «حساب جديد» is the default. «من موظف» exists only with the bridge, and `?employee_id=` opens it.
type Mode = 'account' | 'employee'
const chosenMode = ref<Mode>()
const mode = computed<Mode>(() => bridge.available.value && (chosenMode.value ?? (hasRequestedEmployee ? 'employee' : 'account')) === 'employee' ? 'employee' : 'account')
const modeItems = computed(() => [{ value: 'account', label: t('access.users.modeAccount') }, { value: 'employee', label: t('access.users.modeEmployee') }])
const roles = useAdminRoles({}, computed(() => !forbidden.value && can('access.roles.read')))
const grant = useGrantAdminAccount()
const grantFromEmployee = useGrantEmployeeAccount()
const addMembership = useAddMembership()
const reactivate = useReactivateAdminUser()
const updateAccess = useUpdateAdminUserAccess()
const employeeId = ref<number | undefined>(hasRequestedEmployee ? requestedEmployeeId : undefined)
const selectedCandidate = ref<EmployeeAccountCandidate>()
const name = ref('')
const login = ref('')
const selectedRoleIds = ref<number[]>([])
const errorKey = ref('')
const saved = ref(false)
// What the last send was for, once it went out: the confirmation names this address.
const sent = ref<{ id: number; email: string; reactivated: boolean } | null>(null)
// The typed email belongs to an account of the organisation whose home is another company: the person adding it confirms first.
const existing = ref<{ name: string; homeCompany: MembershipCompany } | null>(null)
const membershipError = ref('')
const added = ref<{ name: string } | null>(null)
const dirty = computed(() => !saved.value && (name.value !== '' || login.value !== '' || (mode.value === 'employee' && employeeId.value !== undefined) || selectedRoleIds.value.length > 0))
const availableRoles = computed<RoleOption[]>(() => (roles.data.value?.items ?? []).filter((role) => role.active && role.assignable).map((role) => ({ id: role.id, name: role.name, description: [t('access.roles.companyScope')] })))
const stoppedUserId = computed<number | null>(() => mode.value === 'employee' && selectedCandidate.value?.user_id != null && selectedCandidate.value.access_active === false ? selectedCandidate.value.user_id : null)
const existingUser = useAdminUser(stoppedUserId, computed(() => !forbidden.value && stoppedUserId.value !== null))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value && can('access.roles.read')))
const permissionLabels = computed(() => new Map<string, string>((catalog.data.value?.items ?? []).map((permission) => [permission.key, permission.label[locale.value === 'ar' ? 'ar' : 'en'] ?? permission.label.ar])))
const roleDetails = useAdminRoleDetails(selectedRoleIds, computed(() => !forbidden.value && can('access.roles.read')))
const selectedCapabilities = computed(() => [...new Set((roleDetails.data.value ?? []).flatMap((role) => role.permissions))].map((key) => permissionLabels.value.get(key) ?? t('access.roles.unknownPermission')))
const isReactivation = computed(() => stoppedUserId.value !== null)
const employeeBlocked = computed(() => !selectedCandidate.value || (selectedCandidate.value.user_id !== null && selectedCandidate.value.access_active !== false))
const loginInvalid = computed(() => login.value.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.value.trim()))
const loginMissing = computed(() => login.value.trim() === '' || loginInvalid.value)
// A stopped account keeps its own login, so only a new account needs an address here.
const identityMissing = computed(() => mode.value === 'employee' ? employeeBlocked.value || (!isReactivation.value && loginMissing.value) : name.value.trim() === '' || loginMissing.value)
// A pending invitation holds a seat, and so does a reactivated account: the form shows which seat this one is and stops at the limit.
const seats = useAdminUserSeats(computed(() => !forbidden.value))
const seatLimit = computed(() => seats.data.value?.limit ?? null)
const seatNumber = computed(() => (seats.data.value?.used ?? 0) + 1)
const atSeatLimit = computed(() => seatLimit.value !== null && (seats.data.value?.used ?? 0) >= seatLimit.value)
const busy = computed(() => addMembership.isPending.value || grant.isPending.value || grantFromEmployee.isPending.value || reactivate.isPending.value || updateAccess.isPending.value)
// The employee's work email is the suggested login; the administrator may change it before sending.
watch(selectedCandidate, (candidate, previous) => {
  if (mode.value === 'employee' && (login.value === '' || login.value === (previous?.work_email ?? ''))) login.value = candidate?.work_email ?? ''
})
watch(existingUser.data, (user) => {
  if (selectedRoleIds.value.length) return
  selectedRoleIds.value = user?.assignments.map((assignment) => assignment.role.id).filter((id): id is number => id !== null) ?? []
})

async function submit() {
  errorKey.value = ''
  const selectedEmployeeId = employeeId.value
  const selectedRoleIdsSnapshot = selectedRoleIds.value.slice()
  const reactivating = isReactivation.value
  const companyId = me.value?.company.id
  if (identityMissing.value || selectedRoleIdsSnapshot.length === 0 || !companyId || !hydrated.value || atSeatLimit.value) return
  const assignments = selectedRoleIdsSnapshot.map((role_id) => ({ role_id, scope: { kind: 'company' as const, id: companyId } }))
  try {
    let user: Awaited<ReturnType<typeof grant.mutateAsync>>
    if (mode.value === 'account') {
      user = await grant.mutateAsync({ name: name.value, login: login.value.trim(), assignments })
    } else if (reactivating) {
      if (!existingUser.data.value) { errorKey.value = t('access.users.loadingAccount'); return }
      user = await updateAccess.mutateAsync({ id: existingUser.data.value.id, body: { expected_version: existingUser.data.value.version, assignments } })
      user = await reactivate.mutateAsync({ id: user.id, body: { expected_version: user.version } })
    } else if (selectedEmployeeId) {
      user = await grantFromEmployee.mutateAsync({ employee_id: selectedEmployeeId, login: login.value.trim(), assignments })
    } else return
    saved.value = true
    sent.value = { id: user.id, email: user.login, reactivated: reactivating }
  } catch (error) {
    const details = error instanceof ApiError && error.code === 'account_exists' ? ExistingAccountDetailsSchema.safeParse(error.details) : undefined
    if (details?.success) {
      existing.value = { name: details.data.existing_account.name, homeCompany: details.data.existing_account.home_company }
      return
    }
    errorKey.value = accessErrorMessage(error, t)
  }
}
async function confirmMembership() {
  const companyId = me.value?.company.id
  if (!existing.value || !companyId || !hydrated.value || busy.value) return
  membershipError.value = ''
  try {
    const member = await addMembership.mutateAsync({
      login: login.value.trim(),
      assignments: selectedRoleIds.value.map((role_id) => ({ role_id, scope: { kind: 'company' as const, id: companyId } })),
      ...(mode.value === 'employee' && employeeId.value ? { employee_id: employeeId.value } : {}),
    })
    saved.value = true
    existing.value = null
    added.value = { name: member.name }
  } catch (error) {
    membershipError.value = accessErrorMessage(error, t)
  }
}
function declineMembership() {
  existing.value = null
  membershipError.value = ''
}
function inviteAnother() {
  name.value = ''
  login.value = ''
  employeeId.value = undefined
  selectedCandidate.value = undefined
  selectedRoleIds.value = []
  saved.value = false
  sent.value = null
  added.value = null
}
</script>

<template>
  <SharedCreatePanel :title="t('access.users.grantTitle')" :back-to="backTo">
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <div v-else-if="sent" class="liwan-form">
      <UAlert role="status" color="success" variant="subtle" icon="i-lucide-mail-check" :title="t(sent.reactivated ? 'access.users.resetLinkSentTitle' : 'access.users.invitationSentTitle', { email: sent.email })" :description="sent.reactivated ? undefined : t('access.users.invitationSentBody')" />
      <SharedFormActions>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton color="neutral" variant="outline" :label="t('access.users.inviteAnother')" @click="inviteAnother" />
          <UButton :to="{ path: `/settings/team/users/${sent.id}`, query: { returnTo: backTo } }" color="primary" :label="t('access.users.viewUser')" />
        </div>
      </SharedFormActions>
    </div>
    <div v-else-if="added" class="liwan-form">
      <UAlert role="status" color="success" variant="subtle" icon="i-lucide-user-check" :title="t('access.members.addedTitle', { name: added.name })" :description="t('access.members.addedBody')" />
      <SharedFormActions>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton color="neutral" variant="outline" :label="t('access.users.inviteAnother')" @click="inviteAnother" />
          <UButton :to="backTo" color="primary" :label="t('access.members.backToUsers')" />
        </div>
      </SharedFormActions>
    </div>
    <ExistingAccountConfirm v-else-if="existing" :name="existing.name" :home-company="existing.homeCompany" :pending="addMembership.isPending.value" :error="membershipError" @confirm="confirmMembership" @cancel="declineMembership" />
    <UForm v-else :state="{ name, login, employeeId, selectedRoleIds }" class="liwan-form" method="post" @submit="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedSegmentedControl v-if="bridge.available.value" :label="t('access.users.mode')" :items="modeItems" :model-value="mode" @update:model-value="chosenMode = $event as Mode" />
      <SharedFormSection v-if="mode === 'employee'" panel :title="t('access.users.employee')">
        <div class="grid gap-4">
          <EmployeeAccountPicker v-model="employeeId" v-model:candidate="selectedCandidate" :requested-employee-id="hasRequestedEmployee ? requestedEmployeeId : undefined" />
          <UFormField v-if="selectedCandidate && !isReactivation && !employeeBlocked" :label="t('access.users.loginEmail')" name="login" :help="t('access.users.employeeLoginHint')" :error="loginInvalid ? t('access.users.loginInvalid') : undefined" required>
            <UInput id="login" v-model="login" type="email" autocomplete="off" dir="ltr" class="w-full" required :disabled="!hydrated" />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormSection v-else panel :title="t('access.users.accountDetails')">
        <div class="grid gap-4">
          <UFormField :label="t('access.users.name')" name="name" required>
            <UInput id="name" v-model="name" autocomplete="off" class="w-full" required :disabled="!hydrated" />
          </UFormField>
          <UFormField :label="t('access.users.loginEmail')" name="login" :error="loginInvalid ? t('access.users.loginInvalid') : undefined" required>
            <UInput id="login" v-model="login" type="email" autocomplete="off" dir="ltr" class="w-full" required :disabled="!hydrated" />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormSection panel :title="t('access.users.role')">
        <div class="grid gap-3">
          <RoleCheckboxes v-model="selectedRoleIds" :roles="availableRoles" :legend="t('access.users.role')" :disabled="!hydrated || roles.isLoading.value" />
          <p v-if="roles.isLoading.value" class="text-sm text-muted">{{ t('access.users.loadingRoles') }}</p>
          <UAlert v-else-if="roles.error.value" color="error" variant="subtle" :title="t('errors.generic')" />
        </div>
      </SharedFormSection>
      <p v-if="existingUser.isLoading.value" class="text-sm text-muted">{{ t('access.users.loadingAccount') }}</p>
      <UAlert v-else-if="existingUser.error.value" color="error" variant="subtle" :title="t('errors.generic')" />
      <UAlert v-if="atSeatLimit" role="alert" color="warning" variant="subtle" icon="i-lucide-users" :title="t('access.users.seatLimitReached', { limit: seatLimit })" />
      <p v-else-if="seatLimit !== null" class="text-sm text-muted" data-testid="seat-line">{{ t('access.users.seatLine', { number: seatNumber, limit: seatLimit }) }}</p>
      <SharedFormSection v-if="selectedCapabilities.length" panel :title="t('access.users.resultingCapabilities')">
        <ul class="flex flex-wrap gap-2">
          <li v-for="(capability, index) in selectedCapabilities" :key="index"><SharedStatusBadge tone="neutral" size="sm" :label="capability" /></li>
        </ul>
      </SharedFormSection>
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="errorKey" />
      <SharedFormActions>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton :to="backTo" color="neutral" variant="outline" :label="t('app.cancel')" />
          <UButton
            type="submit"
            color="primary"
            :label="isReactivation ? t('access.users.reactivateAccount') : t('access.users.sendInvitation')"
            :disabled="!hydrated || busy || roles.isLoading.value || existingUser.isLoading.value || identityMissing || selectedRoleIds.length === 0 || atSeatLimit"
          />
        </div>
      </SharedFormActions>
    </UForm>
  </SharedCreatePanel>
</template>
