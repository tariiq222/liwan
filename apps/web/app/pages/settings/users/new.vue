<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useAdminUser, useGrantAdminAccount, useReactivateAdminUser, useUpdateAdminUserAccess, useAdminUserCandidates } from '@/composables/useAdminUsers'
import { useAdminPermissionCatalog, useAdminRoleDetails, useAdminRoles } from '@/composables/useAdminRoles'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'

const { t, locale } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const { me } = useMe()
const forbidden = computed(() => !can('access.users.grant'))
const route = useRoute()
const backTo = computed(() => {
  return adminPathWithQuery('/settings/users', adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset']))
})
const requestedEmployeeId = Number(route.query.employee_id)
const hasRequestedEmployee = Number.isInteger(requestedEmployeeId) && requestedEmployeeId > 0
const candidateParams = reactive({ q: '', employee_id: hasRequestedEmployee ? requestedEmployeeId : undefined, limit: 25, offset: 0 })
const employees = useAdminUserCandidates(candidateParams, computed(() => !forbidden.value))
const roles = useAdminRoles({}, computed(() => !forbidden.value && can('access.roles.read')))
const grant = useGrantAdminAccount()
const reactivate = useReactivateAdminUser()
const updateAccess = useUpdateAdminUserAccess()
const employeeId = ref<number | undefined>(hasRequestedEmployee ? requestedEmployeeId : undefined)
const selectedRoleIds = ref<number[]>([])
const password = ref('')
const passwordConfirmation = ref('')
const errorKey = ref('')
const saved = ref(false)
const dirty = computed(() => !saved.value && (employeeId.value !== undefined || selectedRoleIds.value.length > 0 || password.value.length > 0 || passwordConfirmation.value.length > 0))
const availableRoles = computed(() => (roles.data.value?.items ?? []).filter((role) => role.active && role.assignable))
const selectedCandidate = computed(() => employees.data.value?.items.find((candidate) => candidate.id === employeeId.value))
const stoppedUserId = computed<number | null>(() => selectedCandidate.value?.user_id != null && selectedCandidate.value.access_active === false ? selectedCandidate.value.user_id : null)
const existingUser = useAdminUser(stoppedUserId, computed(() => !forbidden.value && stoppedUserId.value !== null))
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value && can('access.roles.read')))
const permissionLabels = computed(() => new Map<string, string>((catalog.data.value?.items ?? []).map((permission) => [permission.key, permission.label[locale.value === 'ar' ? 'ar' : 'en'] ?? permission.label.ar])))
const roleDetails = useAdminRoleDetails(selectedRoleIds, computed(() => !forbidden.value && can('access.roles.read')))
const selectedCapabilities = computed(() => [...new Set((roleDetails.data.value ?? []).flatMap((role) => role.permissions))].map((key) => permissionLabels.value.get(key) ?? t('access.roles.unknownPermission')))
const isReactivation = computed(() => stoppedUserId.value !== null)
const candidatePage = computed(() => Math.floor(candidateParams.offset / candidateParams.limit) + 1)
const candidatePages = computed(() => Math.max(1, Math.ceil((employees.data.value?.total ?? 0) / candidateParams.limit)))
const employeeOptions = computed(() => (employees.data.value?.items ?? []).map((employee) => ({
  value: String(employee.id),
  label: `${employee.name}${employee.work_email ? ` — ${employee.work_email}` : ''}${employee.user_id && employee.access_active === false ? ` — ${t('access.users.stoppedAccount')}` : ''}`,
  disabled: employee.user_id !== null && employee.access_active !== false,
})))
function onEmployeeChange(value: unknown) { employeeId.value = value ? Number(value) : undefined }
watch(() => candidateParams.q, () => { candidateParams.offset = 0 })
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
  if (error.status === 409 || error.code === 'conflict') return t('access.errors.conflict')
  if (error.code === 'weak_password') return t('access.errors.weakPassword')
  const translated = `access.errors.${error.code}`
  return error.code && t(translated) !== translated ? t(translated) : (error.message || t('errors.generic'))
}

function previousCandidates() {
  if (!hydrated.value) return
  candidateParams.offset = Math.max(0, candidateParams.offset - candidateParams.limit)
}

function nextCandidates() {
  if (!hydrated.value || candidateParams.offset + candidateParams.limit >= (employees.data.value?.total ?? 0)) return
  candidateParams.offset += candidateParams.limit
}

async function submit() {
  errorKey.value = ''
  const selectedEmployeeId = employeeId.value
  const selectedRoleIdsSnapshot = selectedRoleIds.value.slice()
  const companyId = me.value?.company.id
  if (!selectedEmployeeId || selectedRoleIdsSnapshot.length === 0 || !companyId || !hydrated.value || password.value !== passwordConfirmation.value) return
  const assignments = selectedRoleIdsSnapshot.map((role_id) => ({ role_id, scope: { kind: 'company' as const, id: companyId } }))
  try {
    let user: Awaited<ReturnType<typeof grant.mutateAsync>>
    if (isReactivation.value) {
      if (!existingUser.data.value) { errorKey.value = t('access.users.loadingAccount'); return }
      user = await updateAccess.mutateAsync({ id: existingUser.data.value.id, body: { expected_version: existingUser.data.value.version, assignments } })
      user = await reactivate.mutateAsync({ id: user.id, body: { expected_version: user.version, password: password.value } })
    } else {
      user = await grant.mutateAsync({ employee_id: selectedEmployeeId, password: password.value, assignments })
    }
    password.value = ''
    passwordConfirmation.value = ''
    saved.value = true
    await navigateTo(adminPathWithQuery(`/settings/users/${user.id}`, adminListQuery(route.query, ['q', 'status', 'role_id', 'department_id', 'offset'])))
  } catch (error) {
    password.value = ''
    passwordConfirmation.value = ''
    errorKey.value = showError(error)
  }
}
</script>

<template>
  <SettingsLayout width="form">
    <SharedPageHeader :title="t('access.users.grantTitle')" :back-to="backTo" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <UForm v-else :state="{ employeeId, selectedRoleIds, password, passwordConfirmation }" class="space-y-6" method="post" @submit="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedFormSection :title="t('access.users.employee')" class="space-y-4">
        <UFormField :label="t('access.users.employee')" name="employee-search">
          <UInput id="employee-search" v-model="candidateParams.q" class="w-full" :placeholder="t('access.users.filters.search')" :disabled="!hydrated || hasRequestedEmployee" icon="i-lucide-search" />
        </UFormField>
        <USelect
          id="employee"
          :model-value="employeeId ? String(employeeId) : undefined"
          :items="employeeOptions"
          class="w-full"
          :aria-label="t('access.users.chooseEmployee')"
          :placeholder="t('access.users.chooseEmployee')"
          :disabled="!hydrated || employees.isLoading.value"
          @update:model-value="onEmployeeChange"
        />
        <p v-if="employees.isLoading.value" class="text-xs text-muted">{{ t('access.users.loadingCandidates') }}</p>
        <p v-else-if="employees.error.value" role="alert" class="text-xs text-error">{{ t('errors.generic') }}</p>
        <p v-if="selectedCandidate?.user_id && selectedCandidate.access_active !== false" role="alert" class="text-xs text-error">{{ t('access.users.alreadyHasAccount') }}</p>
        <div v-if="candidatePages > 1" class="flex items-center justify-between text-xs text-muted">
          <UButton type="button" color="secondary" variant="ghost" size="sm" :disabled="!hydrated || candidateParams.offset === 0 || employees.isFetching.value" :label="t('access.users.previousCandidates')" @click="previousCandidates" />
          <span>{{ t('access.users.candidatePage', { page: candidatePage, pages: candidatePages }) }}</span>
          <UButton type="button" color="secondary" variant="ghost" size="sm" :disabled="!hydrated || candidatePage >= candidatePages || employees.isFetching.value" :label="t('access.users.nextCandidates')" @click="nextCandidates" />
        </div>
      </SharedFormSection>
      <SharedFormSection :title="t('access.users.role')" class="space-y-4">
        <fieldset class="space-y-3" :disabled="!hydrated || roles.isLoading.value">
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
          <p v-if="roles.isLoading.value" class="text-xs text-muted">{{ t('access.users.loadingRoles') }}</p>
          <p v-else-if="roles.error.value" role="alert" class="text-xs text-error">{{ t('errors.generic') }}</p>
        </fieldset>
      </SharedFormSection>
      <p v-if="existingUser.isLoading.value" class="text-xs text-muted">{{ t('access.users.loadingAccount') }}</p>
      <p v-else-if="existingUser.error.value" role="alert" class="text-xs text-error">{{ t('errors.generic') }}</p>
      <SharedFormSection :title="t('access.users.password')" class="space-y-4">
        <UFormField :label="t('access.users.password')" name="password">
          <UInput id="password" v-model="password" type="password" autocomplete="new-password" dir="ltr" class="w-full" :disabled="!hydrated" />
        </UFormField>
        <UFormField :label="t('access.users.passwordConfirmation')" name="password-confirmation">
          <UInput id="password-confirmation" v-model="passwordConfirmation" type="password" autocomplete="new-password" dir="ltr" class="w-full" :disabled="!hydrated" />
        </UFormField>
        <p v-if="passwordConfirmation && password !== passwordConfirmation" class="text-xs text-error">{{ t('access.users.passwordMismatch') }}</p>
      </SharedFormSection>
      <SharedFormSection v-if="selectedCapabilities.length" :title="t('access.users.resultingCapabilities')" class="space-y-2">
        <p class="text-xs text-muted">{{ selectedCapabilities.join('، ') }}</p>
      </SharedFormSection>
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="errorKey" />
      <footer class="flex justify-end">
        <UButton
          type="submit"
          color="primary"
          :label="isReactivation ? t('access.users.reactivateAccount') : t('access.users.grantAccount')"
          :disabled="!hydrated || grant.isPending.value || reactivate.isPending.value || updateAccess.isPending.value || employees.isLoading.value || roles.isLoading.value || existingUser.isLoading.value || !employeeId || selectedRoleIds.length === 0 || !selectedCandidate || (selectedCandidate.user_id !== null && selectedCandidate.access_active !== false) || password.length < 8 || password !== passwordConfirmation"
        />
      </footer>
    </UForm>
  </SettingsLayout>
</template>
