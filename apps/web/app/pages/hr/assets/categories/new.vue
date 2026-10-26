<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { owningListBack } from '@/utils/recordListOrigin'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/assets/categories'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const canManage = computed(() => can('hr.assets.manage'))
const { mutateAsync: createCategory, isPending } = useCreateHrAssetCategory()

const name = ref('')
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')
const dirty = computed(() => !saved.value && !!name.value.trim())
const nameError = computed(() => attempted.value && !name.value.trim()
  ? t('hrAssets.categories.form.nameRequired')
  : serverField.value === 'name' ? error.value : undefined)

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!name.value.trim()) return
  try {
    await createCategory({ name: name.value.trim() })
    saved.value = true
    await nextTick()
    await navigateTo(backTo.value, { replace: true })
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <SharedCreatePanel :title="t('hrAssets.categories.new')" :back-to="backTo">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedForbiddenState v-if="!canManage" />
    <UForm v-else novalidate :state="{ name }" class="webvue-form" method="post" data-testid="hr-asset-category-form" @submit="submit">
      <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
      <SharedFormSection panel :title="t('hrAssets.categories.form.details')">
        <UFormField :label="t('hrAssets.categories.columns.name')" name="hr-asset-category-name" required :error="nameError">
          <UInput
            id="hr-asset-category-name"
            v-model="name"
            class="w-full"
            :placeholder="t('hrAssets.categories.form.namePlaceholder')"
            :disabled="!hydrated || isPending"
            data-testid="hr-asset-category-name"
          />
        </UFormField>
      </SharedFormSection>
      <SharedFormActions>
        <span class="text-xs text-muted">{{ t('hrAssets.form.requiredHint') }}</span>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
          <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('hrAssets.form.submit')" data-testid="hr-asset-category-submit" />
        </div>
      </SharedFormActions>
    </UForm>
  </SharedCreatePanel>
</template>
