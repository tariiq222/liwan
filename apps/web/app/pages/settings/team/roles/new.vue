<script setup lang="ts">
import { joinList } from '@/utils/listFormat'
import { owningListBack } from '@/utils/recordListOrigin'
import type { Capability, PermissionDefinition } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { useAdminPermissionCatalog, useAdminRole, useCreateAdminRole } from '@/composables/useAdminRoles'
import { adminListQuery } from '@/composables/adminSettingsPaths'
import { permissionDomainLabel, builtinRoleDescription } from '@/utils/labelFallback'
import { saveErrorMessage } from '@/utils/formFeedback'
import { accessErrorMessage } from '@/utils/accessErrors'

const { t, te, locale } = useI18n()
const domainLabel = (domain: string) => permissionDomainLabel(domain, t, te)
const route = useRoute()
const router = useRouter()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('access.roles.manage'))
const create = useCreateAdminRole()
const catalog = useAdminPermissionCatalog(computed(() => !forbidden.value))
const cloneId = computed(() => route.query.clone ? Number(route.query.clone) : null)
const sourcePaths = useRecordListPaths(['/settings/team/roles'])
const backTo = computed(() => router.resolve(owningListBack({ ...adminListQuery(route.query, ['q', 'type', 'status', 'offset']), returnTo: route.query.returnTo ?? null }, sourcePaths.value, route.hash)).fullPath)
const clone = useAdminRole(cloneId, computed(() => can('access.roles.manage') && cloneId.value !== null))
const nameAr = ref('')
const nameEn = ref('')
const description = ref('')
const selected = ref<Capability[]>([])
const errorKey = ref('')
const nameError = ref<string>()
watch(nameAr, () => { nameError.value = undefined })
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
  description.value = builtinRoleDescription(role, t, te)
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
  if (error instanceof ApiError && error.status === 0) return saveErrorMessage(error, t('errors.generic'), t('errors.saveUncertain'))
  return accessErrorMessage(error, t)
}

let submitting = false
async function submit() {
  if (!hydrated.value || submitting) return
  errorKey.value = ''
  nameError.value = undefined
  if (!nameAr.value.trim()) {
    nameError.value = t('access.roles.nameRequired')
    await nextTick()
    document.getElementById('name-ar')?.focus()
    return
  }
  submitting = true
  try {
    const role = await create.mutateAsync({ name: { ar: nameAr.value, en: nameEn.value || null }, description: description.value, permissions: selected.value })
    saved.value = true
    await navigateTo({ path: `/settings/team/roles/${role.id}`, query: { returnTo: backTo.value } }, { replace: true })
  } catch (error) {
    if (error instanceof ApiError && ['name', 'name.ar', 'name_ar'].includes(error.field ?? '')) {
      nameError.value = error.message
      await nextTick()
      document.getElementById('name-ar')?.focus()
    } else errorKey.value = showError(error)
  } finally {
    submitting = false
  }
}
</script>

<template>
  <SharedCreatePanel :title="t('access.roles.createTitle')" :back-to="backTo">
    <SharedForbiddenState v-if="forbidden" :description="t('access.forbidden')" />
    <UForm v-else :state="{ nameAr, nameEn, description }" class="webvue-form" method="post" :loading-auto="false" novalidate @submit="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <SharedFormSection panel :title="t('access.roles.details')">
        <div class="grid gap-4">
          <div class="webvue-form-grid">
            <UFormField :label="t('access.roles.nameArabic')" name="name-ar" required :error="nameError"><UInput id="name-ar" v-model="nameAr" class="w-full" required :disabled="!hydrated || create.isPending.value" /></UFormField>
            <UFormField :label="t('access.roles.nameEnglish')" name="name-en"><UInput id="name-en" v-model="nameEn" dir="ltr" class="w-full" :disabled="!hydrated || create.isPending.value" /></UFormField>
          </div>
          <UFormField :label="t('access.roles.descriptionLabel')" name="description"><UTextarea id="description" v-model="description" class="w-full" :disabled="!hydrated || create.isPending.value" /></UFormField>
        </div>
      </SharedFormSection>
      <SharedFormSection panel :title="t('access.roles.permissions')">
        <fieldset class="grid min-w-0 gap-3" :disabled="!hydrated || create.isPending.value">
          <legend class="sr-only">{{ t('access.roles.permissions') }}</legend>
          <SharedSubCard v-for="[domain, domainPermissions] in groupedPermissions" :key="domain" tone="tinted" as="section" class="grid gap-3">
            <h3 class="text-sm font-semibold text-highlighted">{{ domainLabel(domain) }}</h3>
            <div class="grid gap-3 md:grid-cols-2">
              <UCheckbox
                v-for="permission in domainPermissions"
                :key="permission.key"
                :model-value="selected.includes(permission.key)"
                @update:model-value="(value) => togglePermission(permission.key, Boolean(value))"
              >
                <template #label><span class="font-medium">{{ permissionLabel(permission.key) }}</span></template>
                <template #description>
                  <span class="block text-sm text-muted">{{ permissionDescription(permission.key) }}</span>
                  <span class="block text-xs text-muted">{{ permission.dependencies.length ? `${t('access.roles.requires')}: ${joinList(permission.dependencies.map((key) => permissionLabel(key)), t)}` : t('access.roles.noDependencies') }}</span>
                  <span class="block text-xs text-muted">{{ t('access.roles.companyScope') }}</span>
                </template>
              </UCheckbox>
            </div>
          </SharedSubCard>
        </fieldset>
      </SharedFormSection>
      <UAlert v-if="errorKey" role="alert" color="error" variant="subtle" :title="errorKey" />
      <SharedFormActions>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton :to="backTo" color="neutral" variant="outline" :disabled="create.isPending.value" :label="t('app.cancel')" />
          <UButton type="submit" color="primary" :disabled="!hydrated || create.isPending.value" :loading="create.isPending.value" :label="t('access.roles.create')" />
        </div>
      </SharedFormActions>
    </UForm>
  </SharedCreatePanel>
</template>
