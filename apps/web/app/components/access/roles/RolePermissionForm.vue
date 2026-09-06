<script setup lang="ts">
import type { PermissionDefinition, RoleDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useUpdateAdminRole } from '@/composables/useAdminRoles'

const props = defineProps<{ role: RoleDetail; permissions: PermissionDefinition[]; readonly?: boolean }>()
const emit = defineEmits<{ saved: []; conflict: [ApiError] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const update = useUpdateAdminRole()
const nameAr = ref(props.role.name.ar)
const nameEn = ref(props.role.name.en ?? '')
const description = ref(props.role.description)
const selected = ref([...props.role.permissions])
const errorMessage = ref('')
const saved = ref(false)
const dirty = computed(() => !saved.value && (nameAr.value !== props.role.name.ar || nameEn.value !== (props.role.name.en ?? '') || description.value !== props.role.description || JSON.stringify([...selected.value].sort()) !== JSON.stringify([...props.role.permissions].sort())))
const canEdit = computed(() => hydrated.value && !props.readonly && props.role.allowed_actions.includes('edit') && !props.role.protected && props.role.type === 'custom')
const permissionByKey = computed(() => new Map<string, PermissionDefinition>(props.permissions.map((permission) => [permission.key, permission])))
const permissionLabel = (key: string) => permissionByKey.value.get(key)?.label[locale.value === 'ar' ? 'ar' : 'en'] ?? permissionByKey.value.get(key)?.label.ar ?? t('access.roles.unknownPermission')
const permissionDescription = (permission: PermissionDefinition) => permission.description[locale.value === 'ar' ? 'ar' : 'en'] ?? permission.description.ar
const domainLabel = (domain: string) => t(`access.roles.domains.${domain}`)
const groupedPermissions = computed(() => Object.entries(props.permissions.reduce<Record<string, PermissionDefinition[]>>((groups, permission) => {
  (groups[permission.domain] ??= []).push(permission)
  return groups
}, {})))
const addedPermissions = computed(() => selected.value.filter((key) => !props.role.permissions.includes(key as typeof props.role.permissions[number])))
const removedPermissions = computed(() => props.role.permissions.filter((key) => !selected.value.includes(key)))
const retainedPermissions = computed(() => selected.value.filter((key) => props.role.permissions.includes(key as typeof props.role.permissions[number])))
function showError(error: unknown) {
  if (!(error instanceof ApiError)) return t('errors.generic')
  if (error.status === 409 || error.code === 'conflict') return t('access.roles.conflict')
  const translated = `access.errors.${error.code}`
  return error.code && t(translated) !== translated ? t(translated) : (error.message || t('errors.generic'))
}

function togglePermission(permission: PermissionDefinition, checked: boolean) {
  if (!permission.custom_role_allowed || !canEdit.value) return
  const next = new Set(selected.value)
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
  selected.value = [...next]
}

async function save() {
  errorMessage.value = ''
  if (!dirty.value || !canEdit.value) return
  try {
    await update.mutateAsync({
      id: props.role.id,
      patch: { name: { ar: nameAr.value, en: nameEn.value || null }, description: description.value, permissions: selected.value, expected_version: props.role.version },
    })
    saved.value = true
    emit('saved')
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      emit('conflict', error)
      errorMessage.value = t('access.roles.conflict')
    } else {
      errorMessage.value = showError(error)
    }
  }
}
</script>

<template>
  <form class="nasq-form min-w-0 space-y-5" @submit.prevent="save">
    <SharedUnsavedChanges :dirty="dirty" />
    <div class="nasq-form-grid">
      <div class="space-y-2"><Label for="role-name-ar">{{ t('access.roles.nameArabic') }}</Label><Input id="role-name-ar" v-model="nameAr" :disabled="!canEdit" /></div>
      <div class="space-y-2"><Label for="role-name-en">{{ t('access.roles.nameEnglish') }}</Label><Input id="role-name-en" v-model="nameEn" dir="ltr" :disabled="!canEdit" /></div>
    </div>
    <div class="space-y-2"><Label for="role-description">{{ t('access.roles.descriptionLabel') }}</Label><Textarea id="role-description" v-model="description" :disabled="!canEdit" /></div>
    <fieldset class="min-w-0 space-y-2" :disabled="!canEdit">
      <legend class="font-medium">{{ t('access.roles.permissions') }}</legend>
      <section v-for="[domain, domainPermissions] in groupedPermissions" :key="domain" class="nasq-form-section space-y-3"><h3 class="text-sm font-medium">{{ domainLabel(domain) }}</h3><div class="nasq-settings-options"><label v-for="permission in domainPermissions" :key="permission.key" class="nasq-settings-option"><input type="checkbox" :checked="selected.includes(permission.key)" :disabled="!permission.custom_role_allowed || !canEdit" @change="togglePermission(permission, !selected.includes(permission.key))"><span><span class="font-medium">{{ permissionLabel(permission.key) }}</span><span class="block text-xs text-muted-foreground">{{ permissionDescription(permission) }}</span><span v-if="permission.dependencies.length" class="block text-xs text-muted-foreground">{{ t('access.roles.requires') }}: <span>{{ permission.dependencies.map((key) => permissionLabel(key)).join('، ') }}</span></span></span></label></div></section>
    </fieldset>
    <div v-if="dirty" class="space-y-1 rounded-lg border border-border/80 bg-muted/30 p-3 text-xs"><p class="font-medium">{{ t('access.roles.permissionChanges') }}</p><p v-if="addedPermissions.length">{{ t('access.roles.added') }}: {{ addedPermissions.map((key) => permissionLabel(key)).join('، ') }}</p><p v-if="removedPermissions.length">{{ t('access.roles.removed') }}: {{ removedPermissions.map((key) => permissionLabel(key)).join('، ') }}</p><p v-if="retainedPermissions.length">{{ t('access.roles.retained') }}: {{ retainedPermissions.map((key) => permissionLabel(key)).join('، ') }}</p></div>
    <p v-if="props.role.protected" class="text-sm text-muted-foreground">{{ t('access.protectedRole') }}</p>
    <p v-else-if="!canEdit" class="text-sm text-muted-foreground">{{ t('access.readOnly') }}</p>
    <p v-if="!props.role.active" class="text-sm text-amber-700 dark:text-amber-300">{{ t('access.roles.disabledExistingAssignments') }}</p>
    <p v-if="dirty && props.role.user_count" class="text-sm text-amber-700 dark:text-amber-300">{{ t('access.roles.affectedUsers', { count: props.role.user_count }) }}</p>
    <p v-if="errorMessage" role="alert" class="text-sm text-destructive">{{ errorMessage }}</p>
    <div class="nasq-form-footer"><Button v-if="canEdit" type="submit" :disabled="!dirty || update.isPending.value">{{ t('access.save') }}</Button></div>
  </form>
</template>
