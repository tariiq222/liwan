<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { HrEquipment, HrRef } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'

// The create form of one asset, inside the /hr/assets/new SharedCreatePanel. It posts the
// exact request body and reports the created asset; the page owns the navigation.
const props = defineProps<{
  categories: HrRef[]
  backTo: RouteLocationRaw
}>()
const emit = defineEmits<{ saved: [equipment: HrEquipment] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createEquipment, isPending } = useCreateHrEquipment()

const name = ref('')
const categoryId = ref<number | null>(null)
const serialNo = ref('')
const model = ref('')
const warrantyDate = ref<string | null>(null)
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

const categoryOptions = computed(() => props.categories.map(category => ({
  value: String(category.id),
  label: category.name,
})))
const dirty = computed(() => !saved.value && Boolean(name.value || categoryId.value || serialNo.value || model.value || warrantyDate.value))

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}
const nameError = computed(() => attempted.value && !name.value.trim() ? t('hrAssets.form.nameRequired') : fieldError('name'))

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!name.value.trim()) return
  try {
    const equipment = await createEquipment({
      name: name.value.trim(),
      category_id: categoryId.value ?? undefined,
      serial_no: serialNo.value.trim() || undefined,
      model: model.value.trim() || undefined,
      warranty_date: warrantyDate.value ?? undefined,
    })
    saved.value = true
    await nextTick()
    emit('saved', equipment)
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    serverField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <UForm novalidate :state="{ name, categoryId, serialNo, model, warrantyDate }" class="liwan-form" method="post" data-testid="hr-asset-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormSection panel :title="t('hrAssets.form.details')">
      <div class="grid gap-4">
        <UFormField :label="t('hrAssets.columns.name')" name="hr-asset-name" required :error="nameError">
          <UInput
            id="hr-asset-name"
            v-model="name"
            class="w-full"
            :placeholder="t('hrAssets.form.namePlaceholder')"
            :disabled="!hydrated || isPending"
            data-testid="hr-asset-name"
          />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('hrAssets.columns.category')" name="hr-asset-category">
            <USelect
              id="hr-asset-category"
              class="w-full"
              :model-value="categoryId ? String(categoryId) : undefined"
              :items="categoryOptions"
              :placeholder="t('hrAssets.form.chooseCategory')"
              :disabled="!hydrated || isPending"
              data-testid="hr-asset-category"
              @update:model-value="categoryId = $event ? Number($event) : null"
            />
          </UFormField>
          <UFormField :label="t('hrAssets.form.serialNo')" name="hr-asset-serial">
            <UInput id="hr-asset-serial" v-model="serialNo" class="w-full" :disabled="!hydrated || isPending" data-testid="hr-asset-serial" />
          </UFormField>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('hrAssets.form.model')" name="hr-asset-model">
            <UInput id="hr-asset-model" v-model="model" class="w-full" :disabled="!hydrated || isPending" data-testid="hr-asset-model" />
          </UFormField>
          <UFormField :label="t('hrAssets.form.warrantyDate')" name="hr-asset-warranty" :hint="t('hrAssets.form.warrantyHint')">
            <SharedDateField id="hr-asset-warranty" v-model="warrantyDate" :disabled="!hydrated || isPending" />
          </UFormField>
        </div>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('hrAssets.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('hrAssets.form.submit')" data-testid="hr-asset-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
