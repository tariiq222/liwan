<script setup lang="ts">
import type { Capability, PermissionDefinition } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useAdminPermissionCatalog, useAdminRole, useCreateAdminRole } from '@/composables/useAdminRoles'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'

const { t, locale } = useI18n()
const route = useRoute()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('access.roles.manage'))
const create = useCreateAdminRole()
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value))
const cloneId = computed(() => route.query.clone ? Number(route.query.clone) : null)
const backTo = computed(() => {
  const query = new URLSearchParams()
  for (const key of ['q', 'type', 'status', 'offset']) if (route.query[key]) query.set(key, String(route.query[key]))
  const suffix = query.toString()
  return `/settings/roles${suffix ? `?${suffix}` : ''}`
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
    await navigateTo(`/settings/roles/${role.id}`)
  } catch (error) {
    errorKey.value = showError(error)
  }
}
</script>

<template>
  <SettingsLayout><div class="nasq-page-stack nasq-settings-form-page">
    <SharedPageHeader :title="t('access.roles.createTitle')" :back-to="backTo" />
    <SharedPageState v-if="forbidden" :empty="true" :empty-text="t('access.forbidden')" />
    <form v-else class="nasq-form nasq-panel nasq-panel-body max-w-3xl space-y-5" @submit.prevent="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <div class="nasq-form-grid"><div class="space-y-2"><Label for="name-ar">{{ t('access.roles.nameArabic') }}</Label><Input id="name-ar" v-model="nameAr" /></div><div class="space-y-2"><Label for="name-en">{{ t('access.roles.nameEnglish') }}</Label><Input id="name-en" v-model="nameEn" dir="ltr" /></div></div>
      <div class="space-y-2"><Label for="description">{{ t('access.roles.descriptionLabel') }}</Label><Textarea id="description" v-model="description" /></div>
      <fieldset class="space-y-2"><legend class="font-medium">{{ t('access.roles.permissions') }}</legend><section v-for="[domain, domainPermissions] in groupedPermissions" :key="domain" class="nasq-form-section space-y-3"><h3 class="text-sm font-medium">{{ t(`access.roles.domains.${domain}`) }}</h3><div class="nasq-settings-options"><label v-for="permission in domainPermissions" :key="permission.key" class="nasq-settings-option"><input type="checkbox" :checked="selected.includes(permission.key)" @change="togglePermission(permission.key, !selected.includes(permission.key))"><span><span class="font-medium">{{ permissionLabel(permission.key) }}</span><span class="block text-sm text-muted-foreground">{{ permissionDescription(permission.key) }}</span><span class="block text-xs text-muted-foreground">{{ permission.dependencies.length ? `${t('access.roles.requires')}: ${permission.dependencies.map((key) => permissionLabel(key)).join('، ')}` : t('access.roles.noDependencies') }}</span><span class="block text-xs text-muted-foreground">{{ t('access.roles.companyScope') }}</span></span></label></div></section></fieldset>
      <p v-if="errorKey" role="alert" class="text-sm text-destructive">{{ errorKey }}</p>
      <div class="nasq-form-footer"><Button type="submit" :disabled="!hydrated || create.isPending.value || !nameAr.trim()">{{ t('access.roles.create') }}</Button></div>
    </form>
  </div></SettingsLayout>
</template>
