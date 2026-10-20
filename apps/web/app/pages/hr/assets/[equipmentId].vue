<script setup lang="ts">
import EquipmentCustodyPanel from '@/components/hr/assets/EquipmentCustodyPanel.vue'
import { formatDate } from '@webvue/ui/app/utils/formatDate'
import { ApiError } from '@/composables/useApi'
import { owningListBack } from '@/utils/recordListOrigin'
import type { HrRef } from '@webvue/contracts'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/assets'])
const id = computed(() => Number(route.params.equipmentId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const query = useHrEquipment(computed(() => (validId.value ? id.value : null)))
const equipment = computed(() => query.data.value)
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

const canManage = computed(() => can('hr.assets.manage'))
const categories = useHrAssetCategories()
// The custody control needs the employee directory; every assets role carries
// hr.employees.read through the catalog dependency.
const employees = useHrEmployees(computed(() => ({ limit: 100 })))
const assignment = useAssignHrEquipment()
const release = useReturnHrEquipment()
const scrapping = useArchiveHrEquipment()
const update = useUpdateHrEquipment()

const writing = computed(() => assignment.isPending.value || release.isPending.value || scrapping.isPending.value || update.isPending.value)
const actionError = ref('')
const returning = ref(false)
const archiving = ref(false)
const scrapDate = ref<string | null>(null)

function localToday() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

async function run(action: () => Promise<unknown>) {
  if (!hydrated.value || writing.value) return
  actionError.value = ''
  try {
    await action()
  } catch (cause) {
    actionError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
async function assign(employeeId: number, assignDate: string) {
  await run(() => assignment.mutateAsync({ id: id.value, employeeId, assignDate }))
}
async function confirmReturn() {
  await run(async () => {
    await release.mutateAsync(id.value)
    returning.value = false
  })
}
async function confirmArchive() {
  await run(async () => {
    await scrapping.mutateAsync({ id: id.value, scrapDate: scrapDate.value ?? undefined })
    archiving.value = false
  })
}
function openArchive() {
  scrapDate.value ??= localToday()
  archiving.value = true
}

// The asset fields are edited in place on the record page; the watch re-syncs them from the
// server answer after every write.
const form = reactive({ name: '', categoryId: null as number | null, serialNo: '', model: '', warrantyDate: null as string | null })
const attempted = ref(false)
const editError = ref('')
const editField = ref('')

watch(equipment, (value) => {
  if (!value) return
  form.name = value.name
  form.categoryId = value.category?.id ?? null
  form.serialNo = value.serial_no
  form.model = value.model
  form.warrantyDate = value.warranty_date
}, { immediate: true })

const categoryOptions = computed(() => (categories.data.value?.items ?? []).map(category => ({
  value: String(category.id),
  label: category.name,
})))
const employeeRefs = computed<HrRef[]>(() => (employees.data.value?.items ?? []).map(employee => ({
  id: employee.id,
  name: employee.name,
})))
const dirty = computed(() => {
  const current = equipment.value
  if (!current) return false
  return form.name !== current.name
    || form.categoryId !== (current.category?.id ?? null)
    || form.serialNo !== current.serial_no
    || form.model !== current.model
    || (form.warrantyDate ?? null) !== current.warranty_date
})

function resetForm() {
  const current = equipment.value
  if (!current) return
  form.name = current.name
  form.categoryId = current.category?.id ?? null
  form.serialNo = current.serial_no
  form.model = current.model
  form.warrantyDate = current.warranty_date
  attempted.value = false
  editError.value = ''
  editField.value = ''
}
function fieldError(field: string) {
  return editField.value === field ? editError.value : undefined
}
const nameError = computed(() => attempted.value && !form.name.trim() ? t('hrAssets.form.nameRequired') : fieldError('name'))

async function submit() {
  if (!hydrated.value || writing.value) return
  attempted.value = true
  editError.value = ''
  editField.value = ''
  if (!form.name.trim()) return
  try {
    await update.mutateAsync({
      id: id.value,
      body: {
        name: form.name.trim(),
        category_id: form.categoryId,
        serial_no: form.serialNo.trim(),
        model: form.model.trim(),
        warranty_date: form.warrantyDate,
      },
    })
  } catch (cause) {
    editError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
    editField.value = cause instanceof ApiError ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <SharedRecordPage
    :keep-content="!!equipment"
    :title="equipment?.name || t('hrAssets.title')"
    :description="equipment?.category?.name || t('hrAssets.noCategory')"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="equipment && canManage" #actions>
      <UButton
        v-if="equipment.employee"
        color="neutral"
        variant="outline"
        :disabled="!hydrated || writing"
        :label="t('hrAssets.custody.return')"
        data-testid="hr-asset-return"
        @click="returning = true"
      />
      <UButton
        v-if="equipment.active"
        color="error"
        variant="outline"
        :disabled="!hydrated || writing"
        :label="t('hrAssets.archive.action')"
        data-testid="hr-asset-archive"
        @click="openArchive"
      />
    </template>

    <UAlert v-if="actionError" role="alert" color="error" variant="subtle" :title="actionError" data-testid="hr-asset-action-error" />

    <SharedInlineConfirm
      v-if="returning"
      :title="t('hrAssets.custody.returnConfirm')"
      :description="t('hrAssets.custody.returnHint')"
      :confirm-label="t('hrAssets.custody.return')"
      :pending="release.isPending.value"
      :disabled="!hydrated"
      @confirm="confirmReturn"
      @cancel="returning = false"
    />
    <SharedInlineConfirm
      v-if="archiving"
      :title="t('hrAssets.archive.confirmTitle')"
      :confirm-label="t('hrAssets.archive.action')"
      :pending="scrapping.isPending.value"
      :disabled="!hydrated"
      @confirm="confirmArchive"
      @cancel="archiving = false"
    >
      <UFormField :label="t('hrAssets.archive.scrapDate')" for="hr-asset-scrap-date">
        <SharedDateField id="hr-asset-scrap-date" v-model="scrapDate" :disabled="!hydrated || scrapping.isPending.value" />
      </UFormField>
    </SharedInlineConfirm>

    <SharedIdentityCard
      v-if="equipment"
      :id="equipment.id"
      :name="equipment.name"
      :subtitle="equipment.serial_no || t('hrAssets.noSerial')"
    >
      <template #badge>
        <SharedStatusBadge
          size="sm"
          :tone="equipment.active ? 'success' : 'neutral'"
          :label="equipment.active ? t('hrAssets.state.active') : t('hrAssets.state.archived')"
          data-testid="hr-asset-state"
        />
      </template>
    </SharedIdentityCard>

    <EquipmentCustodyPanel
      v-if="equipment"
      :equipment="equipment"
      :employees="employeeRefs"
      :can-manage="canManage"
      :pending="writing"
      @assign="assign"
    />

    <SharedRecordSection v-if="equipment" variant="panel" :title="t('hrAssets.form.details')">
      <UForm novalidate :state="form" class="webvue-form" method="post" data-testid="hr-asset-edit" @submit="submit">
        <SharedUnsavedChanges :dirty="dirty" />
        <UAlert v-if="editError && !editField" role="alert" color="error" variant="subtle" :title="editError" />
        <div class="grid gap-4">
          <UFormField :label="t('hrAssets.columns.name')" name="hr-asset-edit-name" required :error="nameError">
            <UInput
              id="hr-asset-edit-name"
              v-model="form.name"
              class="w-full"
              :disabled="!hydrated || !canManage || writing"
              data-testid="hr-asset-edit-name"
            />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('hrAssets.columns.category')" name="hr-asset-edit-category">
              <USelect
                id="hr-asset-edit-category"
                class="w-full"
                :model-value="form.categoryId ? String(form.categoryId) : undefined"
                :items="categoryOptions"
                :placeholder="t('hrAssets.form.chooseCategory')"
                :disabled="!hydrated || !canManage || writing"
                data-testid="hr-asset-edit-category"
                @update:model-value="form.categoryId = $event ? Number($event) : null"
              />
            </UFormField>
            <UFormField :label="t('hrAssets.form.warrantyDate')" name="hr-asset-edit-warranty" :hint="t('hrAssets.form.warrantyHint')">
              <SharedDateField id="hr-asset-edit-warranty" v-model="form.warrantyDate" :disabled="!hydrated || !canManage || writing" />
            </UFormField>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('hrAssets.form.serialNo')" name="hr-asset-edit-serial">
              <UInput id="hr-asset-edit-serial" v-model="form.serialNo" class="w-full" :disabled="!hydrated || !canManage || writing" data-testid="hr-asset-edit-serial" />
            </UFormField>
            <UFormField :label="t('hrAssets.form.model')" name="hr-asset-edit-model">
              <UInput id="hr-asset-edit-model" v-model="form.model" class="w-full" :disabled="!hydrated || !canManage || writing" data-testid="hr-asset-edit-model" />
            </UFormField>
          </div>
        </div>
        <SharedFormActions>
          <span class="text-xs text-muted">{{ t('hrAssets.form.requiredHint') }}</span>
          <div class="ms-auto flex flex-wrap items-center gap-2">
            <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || writing || !dirty" :label="t('app.cancel')" @click="resetForm" />
            <UButton type="submit" color="primary" :disabled="!hydrated || !canManage || writing || !dirty" :loading="update.isPending.value" :label="t('app.save')" data-testid="hr-asset-save" />
          </div>
        </SharedFormActions>
      </UForm>
    </SharedRecordSection>

    <template v-if="equipment" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('hrAssets.form.serialNo')" :value="equipment.serial_no || t('hrAssets.detail.empty')" />
        <SharedPropertyRow :label="t('hrAssets.form.model')" :value="equipment.model || t('hrAssets.detail.empty')" />
        <SharedPropertyRow :label="t('hrAssets.form.warrantyDate')" :value="equipment.warranty_date ? formatDate(equipment.warranty_date) : t('hrAssets.detail.empty')" />
        <SharedPropertyRow :label="t('hrAssets.archive.scrapDate')" :value="equipment.scrap_date ? formatDate(equipment.scrap_date) : t('hrAssets.detail.empty')" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
