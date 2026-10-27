<script setup lang="ts">
import { joinList } from '@/utils/listFormat'
import type { RouteLocationRaw } from 'vue-router'
import type { PermissionDefinition, RoleDetail } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { useUpdateAdminRole } from '@/composables/useAdminRoles'
import { permissionDomainLabel, builtinRoleDescription } from '@/utils/labelFallback'

const props = defineProps<{ role: RoleDetail; permissions: PermissionDefinition[]; readonly?: boolean; cancelTo?: RouteLocationRaw }>()
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
// Built-in roles are read-only seed data with an unlocalized description; the readonly view shows
// its localized purpose text, while an editable (custom) role always edits the stored value.
const descriptionView = computed(() => canEdit.value ? description.value : builtinRoleDescription(props.role, t, te))
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
const hint = computed(() => props.role.protected ? t('access.protectedRole') : !canEdit.value ? t('access.readOnly') : '')
const changeGroups = computed(() => [
  { key: 'added', title: t('access.roles.added'), tone: 'success' as const, keys: addedPermissions.value },
  { key: 'removed', title: t('access.roles.removed'), tone: 'destructive' as const, keys: removedPermissions.value },
  { key: 'retained', title: t('access.roles.retained'), tone: 'neutral' as const, keys: retainedPermissions.value },
].filter((group) => group.keys.length))
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
  <UForm :state="{ nameAr, nameEn, description }" class="webvue-form min-w-0" method="post" @submit="save">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="readonly && props.role.protected" color="neutral" variant="subtle" icon="i-lucide-lock" :title="t('access.protectedRole')" />
    <UAlert v-if="!props.role.active" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('access.roles.disabledExistingAssignments')" />
    <SharedFormSection panel :title="t('access.roles.details')">
      <div class="grid gap-4">
        <div class="webvue-form-grid">
          <UFormField :label="t('access.roles.nameArabic')" name="nameAr"><UInput v-model="nameAr" class="w-full" :disabled="!canEdit" /></UFormField>
          <UFormField :label="t('access.roles.nameEnglish')" name="nameEn"><UInput v-model="nameEn" dir="ltr" class="w-full" :disabled="!canEdit" /></UFormField>
        </div>
        <UFormField :label="t('access.roles.descriptionLabel')" name="description"><UTextarea :model-value="descriptionView" class="w-full" :disabled="!canEdit" @update:model-value="(value) => { description = String(value ?? '') }" /></UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('access.roles.permissions')">
      <fieldset class="grid min-w-0 gap-3" :disabled="!canEdit">
        <legend class="sr-only">{{ t('access.roles.permissions') }}</legend>
        <SharedSubCard v-for="[domain, domainPermissions] in groupedPermissions" :key="domain" tone="tinted" as="section" class="grid gap-3">
          <h3 class="text-sm font-semibold text-highlighted">{{ domainLabel(domain) }}</h3>
          <div class="grid gap-3 md:grid-cols-2">
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
                <span v-if="permission.dependencies.length" class="block text-xs text-muted">{{ t('access.roles.requires') }}: <span>{{ joinList(permission.dependencies.map((key) => permissionLabel(key)), t) }}</span></span>
              </template>
            </UCheckbox>
          </div>
        </SharedSubCard>
      </fieldset>
    </SharedFormSection>
    <SharedFormSection v-if="dirty" panel :title="t('access.roles.permissionChanges')">
      <div class="grid gap-4">
        <section v-for="change in changeGroups" :key="change.key" class="grid gap-2">
          <h3 class="text-sm font-semibold text-highlighted">{{ change.title }}</h3>
          <ul class="flex flex-wrap gap-2">
            <li v-for="key in change.keys" :key="key"><SharedStatusBadge size="sm" :tone="change.tone" :label="permissionLabel(key)" /></li>
          </ul>
        </section>
      </div>
    </SharedFormSection>
    <UAlert v-if="dirty && props.role.user_count" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('access.roles.affectedUsers', { count: props.role.user_count }, props.role.user_count)" />
    <UAlert v-if="errorMessage" role="alert" color="error" variant="subtle" :title="errorMessage" />
    <SharedFormActions v-if="!readonly">
      <p v-if="hint" class="min-w-0 text-sm text-muted">{{ hint }}</p>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton v-if="cancelTo" :to="cancelTo" color="neutral" variant="outline" :label="t('app.cancel')" />
        <UButton v-if="canEdit" type="submit" color="primary" :label="t('access.save')" :disabled="!dirty || update.isPending.value" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
