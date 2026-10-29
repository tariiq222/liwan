<script setup lang="ts">
import { joinList } from '@/utils/listFormat'
import type { PermissionDefinition, RoleDetail } from '@webvue/contracts'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { useUpdateAdminRole } from '@/composables/useAdminRoles'
import { accessSaveError } from '@/utils/accessErrors'
import { permissionDomainLabel, builtinRoleDescription } from '@/utils/labelFallback'

const props = defineProps<{ role: RoleDetail; permissions: PermissionDefinition[]; readonly?: boolean; reloadRole?: () => Promise<RoleDetail> }>()
const emit = defineEmits<{ saved: [] }>()
const { t, te, locale } = useI18n()
const hydrated = useHydrated()
const update = useUpdateAdminRole()
const sorted = (keys: readonly string[]) => [...keys].sort()
const { draft, state, save, revert, reload } = useSettingsForm({
  source: () => props.role,
  read: ({ name, description, permissions }) => ({ nameAr: name.ar, nameEn: name.en ?? '', description, permissions: sorted(permissions) }),
  save: async (values, latest) => {
    try {
      return await update.mutateAsync({
        id: latest.id,
        patch: { name: { ar: values.nameAr, en: values.nameEn || null }, description: values.description, permissions: values.permissions as RoleDetail['permissions'], expected_version: latest.version },
      })
    } catch (error) {
      throw accessSaveError(error, t)
    }
  },
  reload: () => props.reloadRole?.() ?? Promise.resolve(props.role),
})
const canEdit = computed(() => !props.readonly && props.role.allowed_actions.includes('edit') && !props.role.protected && props.role.type === 'custom')
const locked = computed(() => !hydrated.value || !canEdit.value || state.value.saving || state.value.reloading)
// Built-in roles are read-only seed data with an unlocalized description; the readonly view shows
// its localized purpose text, while an editable (custom) role always edits the stored value.
const descriptionView = computed(() => canEdit.value ? draft.value.description : builtinRoleDescription(props.role, t, te))
const permissionByKey = computed(() => new Map<string, PermissionDefinition>(props.permissions.map((permission) => [permission.key, permission])))
const permissionLabel = (key: string) => permissionByKey.value.get(key)?.label[locale.value === 'ar' ? 'ar' : 'en'] ?? permissionByKey.value.get(key)?.label.ar ?? t('access.roles.unknownPermission')
const permissionDescription = (permission: PermissionDefinition) => permission.description[locale.value === 'ar' ? 'ar' : 'en'] ?? permission.description.ar
const domainLabel = (domain: string) => permissionDomainLabel(domain, t, te)
const groupedPermissions = computed(() => Object.entries(props.permissions.reduce<Record<string, PermissionDefinition[]>>((groups, permission) => {
  (groups[permission.domain] ??= []).push(permission)
  return groups
}, {})))
const addedPermissions = computed(() => draft.value.permissions.filter((key) => !props.role.permissions.includes(key as typeof props.role.permissions[number])))
const removedPermissions = computed(() => props.role.permissions.filter((key) => !draft.value.permissions.includes(key)))
const retainedPermissions = computed(() => draft.value.permissions.filter((key) => props.role.permissions.includes(key as typeof props.role.permissions[number])))
const changeGroups = computed(() => [
  { key: 'added', title: t('access.roles.added'), tone: 'success' as const, keys: addedPermissions.value },
  { key: 'removed', title: t('access.roles.removed'), tone: 'destructive' as const, keys: removedPermissions.value },
  { key: 'retained', title: t('access.roles.retained'), tone: 'neutral' as const, keys: retainedPermissions.value },
].filter((group) => group.keys.length))

function togglePermission(permission: PermissionDefinition, checked: boolean) {
  if (!permission.custom_role_allowed || locked.value) return
  const next = new Set(draft.value.permissions)
  if (checked) {
    next.add(permission.key)
    const visit = (key: PermissionDefinition['key']) => {
      const definition = permissionByKey.value.get(key)
      for (const dependency of definition?.dependencies ?? []) {
        next.add(dependency)
        visit(dependency)
      }
    }
    visit(permission.key)
  } else {
    const remove = (key: PermissionDefinition['key']) => {
      next.delete(key)
      for (const candidate of props.permissions) {
        if (candidate.dependencies.includes(key as PermissionDefinition['key'])) remove(candidate.key)
      }
    }
    remove(permission.key)
  }
  draft.value.permissions = sorted([...next])
}

// A saved role returns to where the editor came from; the page decides where that is.
async function saveRole() {
  await save()
  if (!state.value.message && !state.value.dirty) emit('saved')
}
</script>

<template>
  <SharedSettingsCard id="role" v-bind="state" :title="t('access.roles.details')" :can-edit="canEdit" @save="saveRole" @revert="revert" @reload="reload">
    <UAlert v-if="!canEdit && role.protected" color="neutral" variant="subtle" icon="i-lucide-lock" :title="t('access.protectedRole')" />
    <UAlert v-if="!role.active" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('access.roles.disabledExistingAssignments')" />
    <UFormField orientation="horizontal" :label="t('access.roles.nameArabic')" name="nameAr"><UInput v-model="draft.nameAr" class="w-full" :disabled="locked" /></UFormField>
    <UFormField orientation="horizontal" :label="t('access.roles.nameEnglish')" name="nameEn"><UInput v-model="draft.nameEn" dir="ltr" class="w-full" :disabled="locked" /></UFormField>
    <UFormField orientation="horizontal" :label="t('access.roles.descriptionLabel')" name="description">
      <UTextarea :model-value="descriptionView" class="w-full" :disabled="locked" @update:model-value="(value) => { draft.description = String(value ?? '') }" />
    </UFormField>
    <fieldset class="grid min-w-0 gap-3" :disabled="locked">
      <legend class="mb-1 text-sm font-medium text-highlighted">{{ t('access.roles.permissions') }}</legend>
      <SharedSubCard v-for="[domain, domainPermissions] in groupedPermissions" :key="domain" tone="tinted" as="section" class="grid gap-3">
        <h3 class="text-sm font-semibold text-highlighted">{{ domainLabel(domain) }}</h3>
        <div class="grid gap-3 md:grid-cols-2">
          <UCheckbox
            v-for="permission in domainPermissions"
            :key="permission.key"
            :model-value="draft.permissions.includes(permission.key)"
            :disabled="!permission.custom_role_allowed || locked"
            @update:model-value="(value) => togglePermission(permission, Boolean(value))"
          >
            <template #label>
              <span class="font-medium">{{ permissionLabel(permission.key) }}</span>
            </template>
            <template #description>
              <span class="block text-xs text-muted">{{ permissionDescription(permission) }}</span>
              <span v-if="permission.dependencies.length" class="block text-xs text-muted">{{ t('access.roles.requires') }}: <span>{{ joinList(permission.dependencies.map((key) => permissionLabel(key)), t) }}</span></span>
            </template>
          </UCheckbox>
        </div>
      </SharedSubCard>
    </fieldset>
    <section v-if="state.dirty" class="grid gap-2">
      <h3 class="text-sm font-medium text-highlighted">{{ t('access.roles.permissionChanges') }}</h3>
      <div class="grid gap-4">
        <section v-for="change in changeGroups" :key="change.key" class="grid gap-2">
          <h3 class="text-sm font-semibold text-highlighted">{{ change.title }}</h3>
          <ul class="flex flex-wrap gap-2">
            <li v-for="key in change.keys" :key="key"><SharedStatusBadge size="sm" :tone="change.tone" :label="permissionLabel(key)" /></li>
          </ul>
        </section>
      </div>
    </section>
    <UAlert v-if="state.dirty && role.user_count" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('access.roles.affectedUsers', { count: role.user_count }, role.user_count)" />
  </SharedSettingsCard>
</template>
