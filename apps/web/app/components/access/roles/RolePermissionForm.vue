<script setup lang="ts">
import type { PermissionDefinition, RoleDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useUpdateAdminRole } from '@/composables/useAdminRoles'
import { permissionDomainLabel } from '@/utils/labelFallback'

const props = defineProps<{ role: RoleDetail; permissions: PermissionDefinition[]; readonly?: boolean }>()
const emit = defineEmits<{ saved: []; conflict: [ApiError] }>()
const { t, te, locale } = useI18n()
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
const domainLabel = (domain: string) => permissionDomainLabel(domain, t, te)
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
  <UForm :state="{ nameAr, nameEn, description }" class="nasq-form min-w-0" method="post" @submit="save">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection :title="t('access.roles.details')" class="space-y-4">
      <div class="nasq-form-grid">
        <UFormField :label="t('access.roles.nameArabic')" name="nameAr"><UInput v-model="nameAr" class="w-full" :disabled="!canEdit" /></UFormField>
        <UFormField :label="t('access.roles.nameEnglish')" name="nameEn"><UInput v-model="nameEn" dir="ltr" class="w-full" :disabled="!canEdit" /></UFormField>
      </div>
      <UFormField :label="t('access.roles.descriptionLabel')" name="description"><UTextarea v-model="description" class="w-full" :disabled="!canEdit" /></UFormField>
    </SharedFormSection>
    <SharedFormSection :title="t('access.roles.permissions')" class="space-y-4">
      <fieldset class="min-w-0 space-y-2" :disabled="!canEdit">
        <legend class="sr-only">{{ t('access.roles.permissions') }}</legend>
        <section v-for="[domain, domainPermissions] in groupedPermissions" :key="domain" class="space-y-3">
          <h3 class="text-sm font-medium">{{ domainLabel(domain) }}</h3>
          <div class="space-y-3">
            <UCheckbox
              v-for="permission in domainPermissions"
              :key="permission.key"
              :model-value="selected.includes(permission.key)"
              :disabled="!permission.custom_role_allowed || !canEdit"
              @update:model-value="(value) => togglePermission(permission, Boolean(value))"
            >
              <template #label>
                <span class="font-medium">{{ permissionLabel(permission.key) }}</span>
              </template>
              <template #description>
                <span class="block text-xs text-muted">{{ permissionDescription(permission) }}</span>
                <span v-if="permission.dependencies.length" class="block text-xs text-muted">{{ t('access.roles.requires') }}: <span>{{ permission.dependencies.map((key) => permissionLabel(key)).join('، ') }}</span></span>
              </template>
            </UCheckbox>
          </div>
        </section>
      </fieldset>
    </SharedFormSection>
    <SharedFormSection v-if="dirty" :title="t('access.roles.permissionChanges')" class="space-y-2">
      <div class="text-xs"><p v-if="addedPermissions.length">{{ t('access.roles.added') }}: {{ addedPermissions.map((key) => permissionLabel(key)).join('، ') }}</p><p v-if="removedPermissions.length">{{ t('access.roles.removed') }}: {{ removedPermissions.map((key) => permissionLabel(key)).join('، ') }}</p><p v-if="retainedPermissions.length">{{ t('access.roles.retained') }}: {{ retainedPermissions.map((key) => permissionLabel(key)).join('، ') }}</p></div>
    </SharedFormSection>
    <p v-if="props.role.protected" class="text-sm text-muted">{{ t('access.protectedRole') }}</p>
    <p v-else-if="!canEdit" class="text-sm text-muted">{{ t('access.readOnly') }}</p>
    <p v-if="!props.role.active" class="text-sm text-warning">{{ t('access.roles.disabledExistingAssignments') }}</p>
    <p v-if="dirty && props.role.user_count" class="text-sm text-warning">{{ t('access.roles.affectedUsers', { count: props.role.user_count }) }}</p>
    <UAlert v-if="errorMessage" role="alert" color="error" variant="subtle" :title="errorMessage" />
    <footer class="nasq-form-footer justify-end">
      <UButton v-if="canEdit" type="submit" color="primary" :label="t('access.save')" :disabled="!dirty || update.isPending.value" />
    </footer>
  </UForm>
</template>
