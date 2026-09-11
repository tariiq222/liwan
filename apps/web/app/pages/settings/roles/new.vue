<script setup lang="ts">
import type { Capability, PermissionDefinition } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useAdminPermissionCatalog, useAdminRole, useCreateAdminRole } from '@/composables/useAdminRoles'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import { adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'

const { t, locale } = useI18n()
const route = useRoute()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('access.roles.manage'))
const create = useCreateAdminRole()
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value))
const cloneId = computed(() => route.query.clone ? Number(route.query.clone) : null)
const backTo = computed(() => {
  return adminPathWithQuery('/settings/roles', adminListQuery(route.query, ['q', 'type', 'status', 'offset']))
})
const clone = useAdminRole(cloneId, computed(() => can('access.roles.manage') && cloneId.value !== null))
const nameAr = ref('')
const nameEn = ref('')
const description = ref('')
const selected = ref<Capability[]>([])
const errorKey = ref('')
const saved = ref(false)
const dirty = computed(() => !saved.value && Boolean(nameAr.value.trim() || nameEn.value.trim() || description.value.trim() || selected.value.length))
const permissionByKey = computed(() => new Map((catalog.data.value?.items ?? []).map((permission) => [permission.key, permission])))
const permissionLabel = (key: Capability) => permissionByKey.value.get(key)?.label[locale.value === 'ar' ? 'ar' : 'en'] ?? permissionByKey.value.get(key)?.label.ar ?? t('access.roles.unknownPermission')
const permissionDescription = (key: Capability) => permissionByKey.value.get(key)?.description[locale.value === 'ar' ? 'ar' : 'en'] ?? permissionByKey.value.get(key)?.description.ar ?? ''
const availablePermissions = computed(() => catalog.data.value?.items.filter((item) => item.custom_role_allowed) ?? [])
const groupedPermissions = computed(() => Object.entries(availablePermissions.value.reduce<Record<string, PermissionDefinition[]>>((groups, permission) => {
  (groups[permission.domain] ??= []).push(permission)
  return groups
}, {})))

watch([clone.data, catalog.data], ([role, permissionCatalog]) => {
  if (!role) return
  nameAr.value = `${role.name.ar} - نسخة`
  nameEn.value = role.name.en ? `${role.name.en} - copy` : ''
  description.value = role.description
  const allowed = new Set((permissionCatalog?.items ?? []).filter((item) => item.custom_role_allowed).map((item) => item.key))
  selected.value = role.permissions.filter((permission): permission is Capability => allowed.has(permission))
})

function togglePermission(key: Capability, checked: boolean) {
  const definition = permissionByKey.value.get(key)
  if (!definition) return
  const next = new Set(selected.value)
  if (checked) {
    next.add(key)
    const visit = (current: Capability) => {
      for (const dependency of permissionByKey.value.get(current)?.dependencies ?? []) {
        next.add(dependency)
        visit(dependency)
      }
    }
    visit(key)
  } else {
    const remove = (current: Capability) => {
      next.delete(current)
      for (const candidate of availablePermissions.value) {
        if (candidate.dependencies.includes(current)) remove(candidate.key)
      }
    }
    remove(key)
  }
  selected.value = [...next].filter((permission): permission is Capability => availablePermissions.value.some((item) => item.key === permission))
}

function showError(error: unknown) {
  if (!(error instanceof ApiError)) return t('errors.generic')
  if (error.status === 409 || error.code === 'conflict') return t('access.errors.conflict')
  const translated = `access.errors.${error.code}`
  return error.code && t(translated) !== translated ? t(translated) : (error.message || t('errors.generic'))
}

async function submit() {
  errorKey.value = ''
  if (!hydrated.value) return
  try {
    const role = await create.mutateAsync({ name: { ar: nameAr.value, en: nameEn.value || null }, description: description.value, permissions: selected.value })
    saved.value = true
    await navigateTo(adminPathWithQuery(`/settings/roles/${role.id}`, adminListQuery(route.query, ['q', 'type', 'status', 'offset'])))
  } catch (error) {
    errorKey.value = showError(error)
  }
}
</script>

<template>
  <SettingsLayout width="form">
    <SharedPageHeader :title="t('access.roles.createTitle')" :back-to="backTo" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <UForm v-else :state="{ nameAr, nameEn, description }" class="space-y-6" method="post" @submit="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <UCard>
        <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('access.roles.details') }}</h2></template>
        <div class="space-y-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('access.roles.nameArabic')" name="name-ar"><UInput id="name-ar" v-model="nameAr" class="w-full" :disabled="!hydrated || create.isPending.value" /></UFormField>
            <UFormField :label="t('access.roles.nameEnglish')" name="name-en"><UInput id="name-en" v-model="nameEn" dir="ltr" class="w-full" :disabled="!hydrated || create.isPending.value" /></UFormField>
          </div>
          <UFormField :label="t('access.roles.descriptionLabel')" name="description"><UTextarea id="description" v-model="description" class="w-full" :disabled="!hydrated || create.isPending.value" /></UFormField>
        </div>
      </UCard>
      <UCard>
        <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('access.roles.permissions') }}</h2></template>
        <fieldset class="space-y-4" :disabled="!hydrated || create.isPending.value">
          <legend class="sr-only">{{ t('access.roles.permissions') }}</legend>
          <section v-for="[domain, domainPermissions] in groupedPermissions" :key="domain" class="space-y-3">
            <h3 class="text-sm font-medium">{{ t(`access.roles.domains.${domain}`) }}</h3>
            <div class="space-y-3">
              <UCheckbox
                v-for="permission in domainPermissions"
                :key="permission.key"
                :model-value="selected.includes(permission.key)"
                @update:model-value="(value) => togglePermission(permission.key, Boolean(value))"
              >
                <template #label><span class="font-medium">{{ permissionLabel(permission.key) }}</span></template>
                <template #description>
                  <span class="block text-sm text-muted">{{ permissionDescription(permission.key) }}</span>
                  <span class="block text-xs text-muted">{{ permission.dependencies.length ? `${t('access.roles.requires')}: ${permission.dependencies.map((key) => permissionLabel(key)).join('، ')}` : t('access.roles.noDependencies') }}</span>
                  <span class="block text-xs text-muted">{{ t('access.roles.companyScope') }}</span>
                </template>
              </UCheckbox>
            </div>
          </section>
        </fieldset>
      </UCard>
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="errorKey" />
      <footer class="flex justify-end"><UButton type="submit" color="primary" :disabled="!hydrated || create.isPending.value || !nameAr.trim()" :label="t('access.roles.create')" /></footer>
    </UForm>
  </SettingsLayout>
</template>
