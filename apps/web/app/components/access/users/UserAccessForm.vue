<script setup lang="ts">
import type { AdminUserDetail, CapabilitySource, EffectiveCapability, PermissionDefinition, RoleSummary } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useAdminRoleDetails } from '@/composables/useAdminRoles'
import { useUpdateAdminUserAccess } from '@/composables/useAdminUsers'
import { permissionDiff } from '@/components/access/permissionDiff'

const props = defineProps<{ user: AdminUserDetail; roles: RoleSummary[]; permissions?: PermissionDefinition[]; permissionsLoading?: boolean; permissionsError?: unknown }>()
const emit = defineEmits<{ saved: []; conflict: [ApiError]; retry: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { me } = useMe()
const update = useUpdateAdminUserAccess()
const errorKey = ref('')
const saved = ref(false)
const selectedRoleIds = ref(props.user.assignments.map((assignment) => assignment.role.id).filter((id): id is number => id !== null))
const dirty = computed(() => !saved.value && JSON.stringify(selectedRoleIds.value.slice().sort()) !== JSON.stringify(props.user.assignments.map((assignment) => assignment.role.id).filter((id): id is number => id !== null).sort()))
const companyId = computed(() => me.value?.company.id ?? null)
const canEdit = computed(() => hydrated.value && companyId.value !== null && props.user.allowed_actions.includes('assign_roles') && !props.user.protected)
const permissionLabels = computed(() => new Map<string, string>((props.permissions ?? []).map((permission) => [permission.key, permission.label[locale.value === 'ar' ? 'ar' : 'en'] ?? permission.label.ar])))
const capabilityLabel = (key: string) => permissionLabels.value.get(key) ?? t('access.roles.unknownPermission')
const roleLabel = (role: { name: { ar: string; en: string | null } }) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar
const currentCapabilities = computed(() => props.user.capabilities.map((capability) => ({
  key: capability.key,
  label: capabilityLabel(capability.key),
  sources: capability.sources.map((source) => roleLabel(source.role)).join('، '),
})))
const originalRoleIds = computed(() => props.user.assignments.map((assignment) => assignment.role.id).filter((id): id is number => id !== null))
const previewRoleIds = computed(() => [...new Set([...originalRoleIds.value, ...selectedRoleIds.value])])
const roleDetails = useAdminRoleDetails(previewRoleIds, computed(() => hydrated.value && canEdit.value))
const catalogReady = computed(() => (props.permissions?.length ?? 0) > 0)
const catalogMissing = computed(() => dirty.value && !props.permissionsLoading && !props.permissionsError && !catalogReady.value)
const previewLoading = computed(() => dirty.value && (roleDetails.isFetching.value || !!props.permissionsLoading))
const previewError = computed(() => dirty.value && (!!roleDetails.error.value || !!props.permissionsError || catalogMissing.value))
const previewReady = computed(() => catalogReady.value && !props.permissionsLoading && !props.permissionsError && !roleDetails.isFetching.value && !roleDetails.error.value)
function toggleRole(roleId: number, checked: boolean) {
  const next = new Set(selectedRoleIds.value)
  if (checked) next.add(roleId)
  else next.delete(roleId)
  selectedRoleIds.value = [...next]
}
const retainedRoleCount = computed(() => selectedRoleIds.value.filter((id) => originalRoleIds.value.includes(id)).length)
const addedRoleCount = computed(() => selectedRoleIds.value.filter((id) => !originalRoleIds.value.includes(id)).length)
const removedRoleCount = computed(() => originalRoleIds.value.filter((id) => !selectedRoleIds.value.includes(id)).length)
const assignmentSource = (roleId: number, roleDetail: { id: number; key: string; name: { ar: string; en: string | null }; type: 'built_in' | 'custom'; protected: boolean }): CapabilitySource | null => {
  const assignment = props.user.assignments.find((item) => item.role.id === roleId)
  if (assignment) return { role_assignment_id: assignment.id, role: assignment.role, scope: assignment.scope, source: 'assignment' }
  if (companyId.value === null) return null
  return { role_assignment_id: null, role: { id: roleDetail.id, key: roleDetail.key, name: roleDetail.name, type: roleDetail.type, protected: roleDetail.protected }, scope: { kind: 'company', id: companyId.value, name: t('access.roles.companyScope') }, source: 'assignment' }
}
const beforeCapabilities = computed(() => props.user.capabilities)
const afterCapabilities = computed<EffectiveCapability[]>(() => {
  const byKey = new Map<string, EffectiveCapability>()
  for (const capability of props.user.capabilities) {
    const retainedSources = capability.sources.filter((source) => source.source !== 'assignment' || (source.role.id !== null && selectedRoleIds.value.includes(source.role.id)))
    if (retainedSources.length) byKey.set(capability.key, { key: capability.key, sources: retainedSources })
  }
  for (const role of roleDetails.data.value ?? []) {
    if (!selectedRoleIds.value.includes(role.id)) continue
    const source = assignmentSource(role.id, role)
    if (!source) continue
    for (const key of role.permissions) {
      const existing = byKey.get(key)
      if (existing) {
        if (!existing.sources.some((item) => item.source === 'assignment' && item.role_assignment_id === source.role_assignment_id && item.role.id === source.role.id)) existing.sources.push(source)
      } else byKey.set(key, { key, sources: [source] })
    }
  }
  return [...byKey.values()]
})
const capabilityChanges = computed(() => permissionDiff(beforeCapabilities.value, afterCapabilities.value))
const addingAccessAdminRole = computed(() => (roleDetails.data.value ?? []).some((role) => selectedRoleIds.value.includes(role.id) && !originalRoleIds.value.includes(role.id) && ['system_admin', 'access_admin'].includes(role.key)))
function retryPreview() {
  emit('retry')
  void roleDetails.refetch()
}
function showError(error: unknown) {
  if (!(error instanceof ApiError)) return t('errors.generic')
  if (error.status === 409 || error.code === 'conflict') return t('access.errors.conflict')
  const translated = `access.errors.${error.code}`
  return error.code && t(translated) !== translated ? t(translated) : (error.message || t('errors.generic'))
}

watch(() => props.user, (user) => {
  selectedRoleIds.value = user.assignments.map((assignment) => assignment.role.id).filter((id): id is number => id !== null)
  errorKey.value = ''
  saved.value = false
})

async function save() {
  errorKey.value = ''
  if (!dirty.value || !canEdit.value) return
  try {
    await update.mutateAsync({
      id: props.user.id,
      body: {
        expected_version: props.user.version,
        assignments: selectedRoleIds.value.map((role_id) => ({ role_id, scope: { kind: 'company' as const, id: companyId.value! } })),
      },
    })
    saved.value = true
    emit('saved')
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      errorKey.value = 'access.errors.conflict'
      emit('conflict', error)
    }
    else errorKey.value = showError(error)
  }
}
</script>

<template>
  <form class="nasq-form" @submit.prevent="save">
    <SharedUnsavedChanges :dirty="dirty" />
    <fieldset :disabled="!canEdit || update.isPending.value" class="space-y-5">
      <legend class="sr-only">{{ t('access.users.rolesTitle') }}</legend>
      <SharedFormSection :title="t('access.users.rolesTitle')" class="space-y-3">
        <div class="space-y-3">
          <UCheckbox
            v-for="role in roles"
            :key="role.id"
            :model-value="selectedRoleIds.includes(role.id)"
            :disabled="(!role.active || !role.assignable) && !selectedRoleIds.includes(role.id)"
            @update:model-value="(value) => toggleRole(role.id, Boolean(value))"
          >
            <template #label><span class="font-medium">{{ roleLabel(role) }}</span></template>
            <template #description>
              <span class="block text-xs text-muted">{{ role.description }}</span>
              <span class="block text-xs text-muted">{{ t('access.roles.companyScope') }}</span>
              <span v-if="!role.active" class="block text-xs text-warning">{{ t('access.roles.disabledExistingAssignments') }}</span>
            </template>
          </UCheckbox>
        </div>
        <p v-if="props.user.protected" class="text-sm text-muted">{{ t('access.protectedUser') }}</p>
        <p v-else-if="!canEdit" class="text-sm text-muted">{{ t('access.readOnly') }}</p>
        <p v-if="dirty" class="text-xs text-muted">{{ t('access.users.assignmentDiff', { retained: retainedRoleCount, added: addedRoleCount, removed: removedRoleCount }) }}</p>
      </SharedFormSection>
      <SharedFormSection :title="t('access.users.currentCapabilities')" class="space-y-3">
        <ul class="space-y-1 text-xs"><li v-for="capability in currentCapabilities" :key="capability.key">{{ capability.label }} <span class="text-muted">({{ capability.sources }})</span></li></ul>
      </SharedFormSection>
      <SharedFormSection v-if="dirty" :title="t('access.users.capabilityChanges')" class="space-y-3">
        <div v-if="previewLoading" class="text-xs text-muted">{{ t('access.users.loadingCapabilities') }}</div>
        <div v-else-if="previewError" role="alert" class="flex items-center gap-2 text-xs text-error"><span>{{ t('access.users.capabilityPreviewError') }}</span><UButton type="button" color="secondary" variant="ghost" size="sm" :label="t('access.retry')" @click="retryPreview" /></div>
        <div v-else class="space-y-1 text-xs"><p v-if="capabilityChanges.added.length">{{ t('access.roles.added') }}: {{ capabilityChanges.added.map((item) => capabilityLabel(item.key)).join('، ') }}</p><p v-if="capabilityChanges.removed.length">{{ t('access.roles.removed') }}: {{ capabilityChanges.removed.map((item) => capabilityLabel(item.key)).join('، ') }}</p><p v-if="capabilityChanges.retained.length">{{ t('access.roles.retained') }}: {{ capabilityChanges.retained.map((item) => `${capabilityLabel(item.key)} (${item.sources.map((source) => source.role.name.ar).join('، ')})`).join('؛ ') }}</p></div>
      </SharedFormSection>
      <UAlert v-if="addingAccessAdminRole" role="alert" color="warning" variant="subtle" :title="t('access.users.accessAdminWarning')" />
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="errorKey.startsWith('access.') || errorKey === 'errors.generic' ? t(errorKey) : errorKey" />
      <footer class="nasq-form-footer justify-end"><UButton v-if="canEdit" type="submit" color="primary" :label="t('access.save')" :disabled="!dirty || update.isPending.value || !previewReady" /></footer>
    </fieldset>
  </form>
</template>
