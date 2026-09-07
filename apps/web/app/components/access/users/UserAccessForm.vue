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
  <form class="nasq-form space-y-5" @submit.prevent="save">
    <SharedUnsavedChanges :dirty="dirty" />
    <fieldset :disabled="!canEdit || update.isPending.value" class="space-y-3">
      <legend class="text-sm font-medium">{{ t('access.users.rolesTitle') }}</legend>
      <div class="nasq-settings-options"><label v-for="role in roles" :key="role.id" class="nasq-settings-option">
        <input v-model="selectedRoleIds" type="checkbox" :value="role.id" :disabled="(!role.active || !role.assignable) && !selectedRoleIds.includes(role.id)" class="mt-1">
        <span><span class="font-medium">{{ roleLabel(role) }}</span><span class="block text-xs text-muted-foreground">{{ role.description }}</span><span class="block text-xs text-muted-foreground">{{ t('access.roles.companyScope') }}</span><span v-if="!role.active" class="block text-xs text-amber-700 dark:text-amber-300">{{ t('access.roles.disabledExistingAssignments') }}</span></span>
      </label></div>
      <p v-if="props.user.protected" class="text-sm text-muted-foreground">{{ t('access.protectedUser') }}</p>
      <p v-else-if="!canEdit" class="text-sm text-muted-foreground">{{ t('access.readOnly') }}</p>
      <div class="space-y-2 rounded-lg border border-border/80 bg-muted/30 p-3"><p class="text-sm font-medium">{{ t('access.users.currentCapabilities') }}</p><ul class="space-y-1 text-xs"><li v-for="capability in currentCapabilities" :key="capability.key">{{ capability.label }} <span class="text-muted-foreground">({{ capability.sources }})</span></li></ul></div>
      <p v-if="dirty" class="text-xs text-muted-foreground">{{ t('access.users.assignmentDiff', { retained: retainedRoleCount, added: addedRoleCount, removed: removedRoleCount }) }}</p>
      <div v-if="previewLoading" class="text-xs text-muted-foreground">{{ t('access.users.loadingCapabilities') }}</div>
      <div v-else-if="previewError" role="alert" class="flex items-center gap-2 text-xs text-destructive"><span>{{ t('access.users.capabilityPreviewError') }}</span><Button type="button" variant="ghost" size="sm" @click="retryPreview">{{ t('access.retry') }}</Button></div>
      <div v-else-if="dirty" class="space-y-1 rounded-lg border border-border/80 bg-muted/30 p-3 text-xs"><p class="font-medium">{{ t('access.users.capabilityChanges') }}</p><p v-if="capabilityChanges.added.length">{{ t('access.roles.added') }}: {{ capabilityChanges.added.map((item) => capabilityLabel(item.key)).join('، ') }}</p><p v-if="capabilityChanges.removed.length">{{ t('access.roles.removed') }}: {{ capabilityChanges.removed.map((item) => capabilityLabel(item.key)).join('، ') }}</p><p v-if="capabilityChanges.retained.length">{{ t('access.roles.retained') }}: {{ capabilityChanges.retained.map((item) => `${capabilityLabel(item.key)} (${item.sources.map((source) => roleLabel(source.role)).join('، ')})`).join('؛ ') }}</p></div>
      <p v-if="addingAccessAdminRole" role="alert" class="text-sm text-amber-700 dark:text-amber-300">{{ t('access.users.accessAdminWarning') }}</p>
      <p v-if="errorKey" role="alert" class="text-sm text-destructive">{{ errorKey.startsWith('access.') || errorKey === 'errors.generic' ? t(errorKey) : errorKey }}</p>
      <div class="nasq-form-footer"><Button v-if="canEdit" type="submit" :disabled="!dirty || update.isPending.value || !previewReady">{{ t('access.save') }}</Button></div>
    </fieldset>
  </form>
</template>
