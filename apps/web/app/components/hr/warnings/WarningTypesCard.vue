<script setup lang="ts">
import type { HrWarningType } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'
import { sortHrWarningTypes } from '@/utils/hrWarnings'

// The warning types manager of the HR settings: rename, change the severity rank, archive and restore,
// and add a type. A row edit saves with the revision it started from, so a concurrent change answers 409
// even after a background refetch; a 409 locks the card until the list is reloaded.
const props = defineProps<{ types: HrWarningType[]; canEdit: boolean; reloadTypes: () => Promise<unknown> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateHrWarningType()
const patch = usePatchHrWarningType()

type Draft = { name: string; severity: number | undefined; revision: number }
const drafts = ref<Record<number, Draft>>({})
const newName = ref('')
const newSeverity = ref<number | undefined>(1)
const attempted = ref(false)
const savingId = ref<number | null>(null)
const failure = ref<unknown>(null)
const reloading = ref(false)

const rows = computed(() => sortHrWarningTypes(props.types))
const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
const busy = computed(() => !props.canEdit || create.isPending.value || savingId.value !== null || reloading.value || conflict.value)
const message = computed(() => failure.value ? (conflict.value ? t('hrWarnings.types.conflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))) : '')
const nameError = computed(() => attempted.value && !newName.value.trim() ? t('hrWarnings.types.nameRequired') : undefined)

function draft(type: HrWarningType) {
  return drafts.value[type.id] ?? { name: type.name, severity: type.severity, revision: type.revision }
}
function setDraft(type: HrWarningType, change: Partial<Pick<Draft, 'name' | 'severity'>>) {
  drafts.value = { ...drafts.value, [type.id]: { ...draft(type), ...change } }
}
function validSeverity(value: number | undefined): value is number {
  return Number.isInteger(value) && value! >= 1 && value! <= 1000
}
function changed(type: HrWarningType) {
  const current = draft(type)
  return current.name !== type.name || current.severity !== type.severity
}
function savable(type: HrWarningType) {
  const current = draft(type)
  return changed(type) && !!current.name.trim() && validSeverity(current.severity)
}

async function run(id: number | null, action: () => Promise<unknown>) {
  if (!hydrated.value || busy.value) return
  failure.value = null
  savingId.value = id
  try {
    await action()
  } catch (error) { failure.value = error } finally { savingId.value = null }
}
async function saveType(type: HrWarningType) {
  const current = draft(type)
  if (!savable(type)) return
  await run(type.id, async () => {
    await patch.mutateAsync({ id: type.id, body: { revision: current.revision, name: current.name.trim(), severity: current.severity } })
    const { [type.id]: _saved, ...rest } = drafts.value
    drafts.value = rest
  })
}
async function setActive(type: HrWarningType, active: boolean) {
  await run(type.id, () => patch.mutateAsync({ id: type.id, body: { revision: type.revision, active } }))
}
async function addType() {
  attempted.value = true
  if (!newName.value.trim() || !validSeverity(newSeverity.value)) return
  const severity = newSeverity.value
  await run(null, async () => {
    await create.mutateAsync({ name: newName.value.trim(), severity })
    newName.value = ''
    attempted.value = false
  })
}
async function reload() {
  if (reloading.value) return
  reloading.value = true
  try {
    await props.reloadTypes()
    drafts.value = {}
    failure.value = null
  } catch (error) { failure.value = error } finally { reloading.value = false }
}
</script>

<template>
  <SharedFormSection panel :title="t('hrWarnings.types.title')" :description="t('hrWarnings.types.hint')">
    <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('hrWarnings.types.saveError')" :description="message" data-testid="hr-warning-types-error" />
    <UButton v-if="conflict" color="neutral" variant="outline" :label="t('hrWarnings.types.reload')" :loading="reloading" :disabled="reloading" data-testid="hr-warning-types-reload" @click="reload" />
    <SharedEmptyState v-if="!rows.length" :title="t('hrWarnings.types.emptyTitle')" :description="t('hrWarnings.types.emptyHint')" />
    <ul v-else class="grid gap-4" data-testid="hr-warning-types">
      <li v-for="type in rows" :key="type.id" class="grid items-end gap-3 sm:grid-cols-[1fr_8rem_13rem]" :data-testid="`hr-warning-type-${type.id}`">
        <UFormField :label="t('hrWarnings.types.name')" :name="`hr-warning-type-name-${type.id}`">
          <UInput :id="`hr-warning-type-name-${type.id}`" class="w-full" :model-value="draft(type).name" :disabled="!hydrated || busy" @update:model-value="setDraft(type, { name: String($event ?? '') })" />
        </UFormField>
        <UFormField :label="t('hrWarnings.types.severity')" :name="`hr-warning-type-severity-${type.id}`">
          <UInputNumber :id="`hr-warning-type-severity-${type.id}`" class="w-full" :model-value="draft(type).severity" :min="1" :max="1000" :step="1" :disabled="!hydrated || busy" @update:model-value="setDraft(type, { severity: $event ?? undefined })" />
        </UFormField>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <SharedStatusBadge v-if="!type.active" size="sm" tone="neutral" :label="t('hrWarnings.types.archived')" />
          <UButton v-if="changed(type)" color="primary" :disabled="!hydrated || busy || !savable(type)" :loading="savingId === type.id" :label="t('hrWarnings.types.save')" data-testid="hr-warning-type-save" @click="saveType(type)" />
          <UButton v-if="props.canEdit" color="neutral" variant="outline" :disabled="!hydrated || busy" :label="type.active ? t('hrWarnings.types.archive') : t('hrWarnings.types.restore')" data-testid="hr-warning-type-toggle" @click="setActive(type, !type.active)" />
        </div>
      </li>
    </ul>
    <form v-if="props.canEdit" class="mt-3 grid items-end gap-3 border-t border-default pt-4 sm:grid-cols-[1fr_8rem_13rem]" data-testid="hr-warning-type-add" @submit.prevent="addType">
      <UFormField :label="t('hrWarnings.types.name')" name="hr-warning-type-new-name" :error="nameError">
        <UInput id="hr-warning-type-new-name" v-model="newName" class="w-full" :placeholder="t('hrWarnings.types.namePlaceholder')" :disabled="!hydrated || busy" />
      </UFormField>
      <UFormField :label="t('hrWarnings.types.severity')" name="hr-warning-type-new-severity">
        <UInputNumber id="hr-warning-type-new-severity" v-model="newSeverity" class="w-full" :min="1" :max="1000" :step="1" :disabled="!hydrated || busy" />
      </UFormField>
      <UButton type="submit" color="primary" :disabled="!hydrated || busy" :loading="create.isPending.value" :label="t('hrWarnings.types.add')" data-testid="hr-warning-type-add-submit" />
    </form>
  </SharedFormSection>
</template>
