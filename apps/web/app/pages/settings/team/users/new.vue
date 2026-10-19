<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { useAdminUser, useGrantAdminAccount, useReactivateAdminUser, useUpdateAdminUserAccess, useAdminUserCandidates } from '@/composables/useAdminUsers'
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

function setCandidatePage(next: number) {
  if (!hydrated.value || next < 1 || next > candidatePages.value) return
  candidateParams.offset = (next - 1) * candidateParams.limit
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
    <UForm v-else :state="{ employeeId, selectedRoleIds, password, passwordConfirmation }" class="webvue-form" method="post" @submit="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedFormSection panel :title="t('access.users.employee')">
        <div class="grid gap-4">
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
          <p v-if="employees.isLoading.value" class="text-sm text-muted">{{ t('access.users.loadingCandidates') }}</p>
          <UAlert v-else-if="employees.error.value" color="error" variant="subtle" :title="t('errors.generic')" />
          <UAlert v-if="selectedCandidate?.user_id && selectedCandidate.access_active !== false" color="error" variant="subtle" :title="t('access.users.alreadyHasAccount')" />
          <SharedPagination :page="candidatePage" :pages="candidatePages" :disabled="employees.isFetching.value" @update:page="setCandidatePage" />
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
            :disabled="!hydrated || grant.isPending.value || reactivate.isPending.value || updateAccess.isPending.value || employees.isLoading.value || roles.isLoading.value || existingUser.isLoading.value || !employeeId || selectedRoleIds.length === 0 || !selectedCandidate || (selectedCandidate.user_id !== null && selectedCandidate.access_active !== false) || password.length < 8 || password !== passwordConfirmation"
          />
        </div>
      </SharedFormActions>
    </UForm>
  </SharedCreatePanel>
</template>
