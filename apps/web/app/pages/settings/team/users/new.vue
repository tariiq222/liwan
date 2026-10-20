<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import EmployeeAccountPicker from '@/components/access/users/EmployeeAccountPicker.vue'
import { useAdminUser, useGrantAdminAccount, useReactivateAdminUser, useUpdateAdminUserAccess } from '@/composables/useAdminUsers'
import { useEmployeeAccountBridge, useGrantEmployeeAccount } from '@/composables/useEmployeeAccounts'
import type { EmployeeAccountCandidate } from '@webvue/contracts'
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
const reactivate = useReactivateAdminUser()
const updateAccess = useUpdateAdminUserAccess()
const employeeId = ref<number | undefined>(hasRequestedEmployee ? requestedEmployeeId : undefined)
const selectedCandidate = ref<EmployeeAccountCandidate>()
const name = ref('')
const login = ref('')
const selectedRoleIds = ref<number[]>([])
const password = ref('')
const passwordConfirmation = ref('')
const errorKey = ref('')
const saved = ref(false)
const dirty = computed(() => !saved.value && (name.value !== '' || login.value !== '' || (mode.value === 'employee' && employeeId.value !== undefined) || selectedRoleIds.value.length > 0 || password.value.length > 0 || passwordConfirmation.value.length > 0))
const availableRoles = computed(() => (roles.data.value?.items ?? []).filter((role) => role.active && role.assignable))
const stoppedUserId = computed<number | null>(() => mode.value === 'employee' && selectedCandidate.value?.user_id != null && selectedCandidate.value.access_active === false ? selectedCandidate.value.user_id : null)
const existingUser = useAdminUser(stoppedUserId, computed(() => !forbidden.value && stoppedUserId.value !== null))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value && can('access.roles.read')))
const permissionLabels = computed(() => new Map<string, string>((catalog.data.value?.items ?? []).map((permission) => [permission.key, permission.label[locale.value === 'ar' ? 'ar' : 'en'] ?? permission.label.ar])))
const roleDetails = useAdminRoleDetails(selectedRoleIds, computed(() => !forbidden.value && can('access.roles.read')))
const selectedCapabilities = computed(() => [...new Set((roleDetails.data.value ?? []).flatMap((role) => role.permissions))].map((key) => permissionLabels.value.get(key) ?? t('access.roles.unknownPermission')))
const isReactivation = computed(() => stoppedUserId.value !== null)
const employeeBlocked = computed(() => !selectedCandidate.value || (selectedCandidate.value.user_id !== null && selectedCandidate.value.access_active !== false))
const loginInvalid = computed(() => login.value.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.value.trim()))
const identityMissing = computed(() => mode.value === 'employee' ? employeeBlocked.value : name.value.trim() === '' || login.value.trim() === '' || loginInvalid.value)
const busy = computed(() => grant.isPending.value || grantFromEmployee.isPending.value || reactivate.isPending.value || updateAccess.isPending.value)
watch(existingUser.data, (user) => {
  if (selectedRoleIds.value.length) return
  selectedRoleIds.value = user?.assignments.map((assignment) => assignment.role.id).filter((id): id is number => id !== null) ?? []
})
function toggleRole(roleId: number, checked: boolean) {
  const next = new Set(selectedRoleIds.value)
  if (checked) next.add(roleId)
  else next.delete(roleId)
  selectedRoleIds.value = [...next]
}

function showError(error: unknown) {
  if (!(error instanceof ApiError)) return t('errors.generic')
  if (error.code === 'weak_password') return t('access.errors.weakPassword')
  const translated = `access.errors.${error.code}`
  if (error.code && t(translated) !== translated) return t(translated)
  if (error.status === 409) return t('access.errors.conflict')
  return error.message || t('errors.generic')
}

async function submit() {
  errorKey.value = ''
  const selectedEmployeeId = employeeId.value
  const selectedRoleIdsSnapshot = selectedRoleIds.value.slice()
  const companyId = me.value?.company.id
  if (identityMissing.value || selectedRoleIdsSnapshot.length === 0 || !companyId || !hydrated.value || password.value !== passwordConfirmation.value) return
  const assignments = selectedRoleIdsSnapshot.map((role_id) => ({ role_id, scope: { kind: 'company' as const, id: companyId } }))
  try {
    let user: Awaited<ReturnType<typeof grant.mutateAsync>>
    if (mode.value === 'account') {
      user = await grant.mutateAsync({ name: name.value, login: login.value, password: password.value, assignments })
    } else if (isReactivation.value) {
      if (!existingUser.data.value) { errorKey.value = t('access.users.loadingAccount'); return }
      user = await updateAccess.mutateAsync({ id: existingUser.data.value.id, body: { expected_version: existingUser.data.value.version, assignments } })
      user = await reactivate.mutateAsync({ id: user.id, body: { expected_version: user.version, password: password.value } })
    } else if (selectedEmployeeId) {
      user = await grantFromEmployee.mutateAsync({ employee_id: selectedEmployeeId, password: password.value, assignments })
    } else return
    password.value = ''
    passwordConfirmation.value = ''
    saved.value = true
    await navigateTo({ path: `/settings/team/users/${user.id}`, query: { returnTo: backTo.value } }, { replace: true })
  } catch (error) {
    password.value = ''
    passwordConfirmation.value = ''
    errorKey.value = showError(error)
  }
}
</script>

<template>
  <SharedCreatePanel :title="t('access.users.grantTitle')" :back-to="backTo">
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <UForm v-else :state="{ name, login, employeeId, selectedRoleIds, password, passwordConfirmation }" class="webvue-form" method="post" @submit="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedSegmentedControl v-if="bridge.available.value" :label="t('access.users.mode')" :items="modeItems" :model-value="mode" @update:model-value="chosenMode = $event as Mode" />
      <SharedFormSection v-if="mode === 'employee'" panel :title="t('access.users.employee')">
        <EmployeeAccountPicker v-model="employeeId" v-model:candidate="selectedCandidate" :requested-employee-id="hasRequestedEmployee ? requestedEmployeeId : undefined" />
      </SharedFormSection>
      <SharedFormSection v-else panel :title="t('access.users.accountDetails')">
        <div class="grid gap-4">
          <UFormField :label="t('access.users.name')" name="name">
            <UInput id="name" v-model="name" autocomplete="off" class="w-full" :disabled="!hydrated" />
          </UFormField>
          <UFormField :label="t('access.users.loginEmail')" name="login" :error="loginInvalid ? t('access.users.loginInvalid') : undefined">
            <UInput id="login" v-model="login" type="email" autocomplete="off" dir="ltr" class="w-full" :disabled="!hydrated" />
          </UFormField>
        </div>
      </SharedFormSection>
      <SharedFormSection panel :title="t('access.users.role')">
        <fieldset class="grid gap-3" :disabled="!hydrated || roles.isLoading.value">
          <legend class="sr-only">{{ t('access.users.role') }}</legend>
          <UCheckbox
            v-for="role in availableRoles"
            :key="role.id"
            :model-value="selectedRoleIds.includes(role.id)"
            @update:model-value="(value) => toggleRole(role.id, Boolean(value))"
          >
            <template #label>{{ role.name[locale === 'ar' ? 'ar' : 'en'] ?? role.name.ar }}</template>
            <template #description><span class="text-xs text-muted">{{ t('access.roles.companyScope') }}</span></template>
          </UCheckbox>
          <p v-if="roles.isLoading.value" class="text-sm text-muted">{{ t('access.users.loadingRoles') }}</p>
          <UAlert v-else-if="roles.error.value" color="error" variant="subtle" :title="t('errors.generic')" />
        </fieldset>
      </SharedFormSection>
      <p v-if="existingUser.isLoading.value" class="text-sm text-muted">{{ t('access.users.loadingAccount') }}</p>
      <UAlert v-else-if="existingUser.error.value" color="error" variant="subtle" :title="t('errors.generic')" />
      <SharedFormSection panel :title="t('access.users.password')">
        <div class="grid gap-4">
          <UFormField :label="t('access.users.password')" name="password">
            <UInput id="password" v-model="password" type="password" autocomplete="new-password" dir="ltr" class="w-full" :disabled="!hydrated" />
          </UFormField>
          <UFormField :label="t('access.users.passwordConfirmation')" name="password-confirmation" :error="passwordConfirmation && password !== passwordConfirmation ? t('access.users.passwordMismatch') : undefined">
            <UInput id="password-confirmation" v-model="passwordConfirmation" type="password" autocomplete="new-password" dir="ltr" class="w-full" :disabled="!hydrated" />
          </UFormField>
        </div>
      </SharedFormSection>
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
            :label="isReactivation ? t('access.users.reactivateAccount') : t('access.users.grantAccount')"
            :disabled="!hydrated || busy || roles.isLoading.value || existingUser.isLoading.value || identityMissing || selectedRoleIds.length === 0 || password.length < 8 || password !== passwordConfirmation"
          />
        </div>
      </SharedFormActions>
    </UForm>
  </SharedCreatePanel>
</template>
