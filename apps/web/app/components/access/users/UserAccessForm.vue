<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { AdminUserDetail, CapabilitySource, EffectiveCapability, PermissionDefinition, RoleSummary } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { useAdminRoleDetails } from '@/composables/useAdminRoles'
import { useUpdateAdminUserAccess } from '@/composables/useAdminUsers'
import CapabilityGroups from '@/components/access/users/CapabilityGroups.vue'
import { permissionDiff } from '@/components/access/permissionDiff'
import { builtinRoleDescription } from '@/utils/labelFallback'

const props = defineProps<{ user: AdminUserDetail; roles: RoleSummary[]; permissions?: PermissionDefinition[]; permissionsLoading?: boolean; permissionsError?: unknown; cancelTo?: RouteLocationRaw }>()
const emit = defineEmits<{ saved: []; conflict: [ApiError]; retry: [] }>()
const { t, te, locale } = useI18n()
const hydrated = useHydrated()
const { me } = useMe()
const update = useUpdateAdminUserAccess()
const errorKey = ref('')
const roleDescription = (role: RoleSummary) => builtinRoleDescription(role, t, te)
const saved = ref(false)
const selectedRoleIds = ref(props.user.assignments.map((assignment) => assignment.role.id).filter((id): id is number => id !== null))
const dirty = computed(() => !saved.value && JSON.stringify(selectedRoleIds.value.slice().sort()) !== JSON.stringify(props.user.assignments.map((assignment) => assignment.role.id).filter((id): id is number => id !== null).sort()))
const companyId = computed(() => me.value?.company.id ?? null)
const canEdit = computed(() => hydrated.value && companyId.value !== null && props.user.allowed_actions.includes('assign_roles') && !props.user.protected)
const permissionLabels = computed(() => new Map<string, string>((props.permissions ?? []).map((permission) => [permission.key, permission.label[locale.value === 'ar' ? 'ar' : 'en'] ?? permission.label.ar])))
const capabilityLabel = (key: string) => permissionLabels.value.get(key) ?? t('access.roles.unknownPermission')
const roleLabel = (role: { name: { ar: string; en: string | null } }) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar
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
const changeGroups = computed(() => {
  const withSources = (item: EffectiveCapability) => `${capabilityLabel(item.key)} · ${item.sources.map((source) => roleLabel(source.role)).join('، ')}`
  return [
    { key: 'added', title: t('access.roles.added'), tone: 'success' as const, items: capabilityChanges.value.added.map((item) => ({ key: item.key, label: capabilityLabel(item.key) })) },
    { key: 'removed', title: t('access.roles.removed'), tone: 'error' as const, items: capabilityChanges.value.removed.map((item) => ({ key: item.key, label: capabilityLabel(item.key) })) },
    { key: 'retained', title: t('access.roles.retained'), tone: 'neutral' as const, items: capabilityChanges.value.retained.map((item) => ({ key: item.key, label: item.sources.length ? withSources(item) : capabilityLabel(item.key) })) },
  ].filter((group) => group.items.length)
})
const hint = computed(() => props.user.protected ? t('access.protectedUser') : !canEdit.value ? t('access.readOnly') : '')
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
  <form class="webvue-form" @submit.prevent="save">
    <SharedUnsavedChanges :dirty="dirty" />
    <fieldset :disabled="!canEdit || update.isPending.value" class="grid min-w-0 gap-(--webvue-gap-card)">
      <legend class="sr-only">{{ t('access.users.rolesTitle') }}</legend>
      <SharedFormSection panel :title="t('access.users.rolesTitle')">
        <div class="grid gap-3">
          <UCheckbox
            v-for="role in roles"
            :key="role.id"
            :model-value="selectedRoleIds.includes(role.id)"
            :disabled="(!role.active || !role.assignable) && !selectedRoleIds.includes(role.id)"
            @update:model-value="(value) => toggleRole(role.id, Boolean(value))"
          >
            <template #label><span class="font-medium">{{ roleLabel(role) }}</span></template>
            <template #description>
              <span class="block text-xs text-muted">{{ roleDescription(role) }}</span>
              <span class="block text-xs text-muted">{{ t('access.roles.companyScope') }}</span>
              <span v-if="!role.active" class="block text-xs text-warning">{{ t('access.roles.disabledExistingAssignments') }}</span>
            </template>
          </UCheckbox>
          <UAlert v-if="dirty" color="neutral" variant="subtle" icon="i-lucide-info" :title="t('access.users.assignmentDiff', { retained: retainedRoleCount, added: addedRoleCount, removed: removedRoleCount })" />
        </div>
      </SharedFormSection>
      <SharedFormSection panel :title="t('access.users.currentCapabilities')">
        <CapabilityGroups :capabilities="props.user.capabilities" :permissions="props.permissions" />
      </SharedFormSection>
      <SharedFormSection v-if="dirty" panel :title="t('access.users.capabilityChanges')">
        <p v-if="previewLoading" class="text-sm text-muted">{{ t('access.users.loadingCapabilities') }}</p>
        <UAlert v-else-if="previewError" role="alert" color="error" variant="subtle" :title="t('access.users.capabilityPreviewError')" :actions="[{ label: t('access.retry'), color: 'neutral', variant: 'outline', onClick: retryPreview }]" />
        <div v-else class="grid gap-4">
          <section v-for="change in changeGroups" :key="change.key" class="grid gap-2">
            <h3 class="text-sm font-semibold text-highlighted">{{ change.title }}</h3>
            <ul class="flex flex-wrap gap-2">
              <li v-for="item in change.items" :key="item.key"><SharedStatusBadge size="sm" :tone="change.tone" :label="item.label" /></li>
            </ul>
          </section>
        </div>
      </SharedFormSection>
      <UAlert v-if="addingAccessAdminRole" role="alert" color="warning" variant="subtle" :title="t('access.users.accessAdminWarning')" />
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="errorKey.startsWith('access.') || errorKey === 'errors.generic' ? t(errorKey) : errorKey" />
      <SharedFormActions>
        <p v-if="hint" class="min-w-0 text-sm text-muted">{{ hint }}</p>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton v-if="cancelTo" :to="cancelTo" color="neutral" variant="outline" :label="t('app.cancel')" />
          <UButton v-if="canEdit" type="submit" color="primary" :label="t('access.save')" :disabled="!dirty || update.isPending.value || !previewReady" />
        </div>
      </SharedFormActions>
    </fieldset>
  </form>
</template>
