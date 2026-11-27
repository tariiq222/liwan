<script setup lang="ts">
import type { HelpdeskCategoryResource, HelpdeskResource } from '@liwan/contracts'
import { useSaveHelpdeskResource, type HelpdeskResourceKind } from '@/composables/helpdesk/useHelpdeskResources'
import { saveErrorMessage } from '@/utils/formFeedback'

// One value list of the support settings (categories, tags, channels or types): rename inline, archive, and add a row.
// Categories keep a parent so a tenant can build the tree its sector uses; the server refuses a cycle.
const props = defineProps<{
  kind: Exclude<HelpdeskResourceKind, 'teams' | 'stages'>
  rows: (HelpdeskResource | HelpdeskCategoryResource)[]
  canEdit: boolean
}>()
const { t } = useI18n()
const hydrated = useHydrated()
const save = useSaveHelpdeskResource(props.kind)
const newName = ref('')
const newParentId = ref<number | null>(null)
const adding = ref(false)
const savingId = ref<number | null>(null)
const failure = ref<string | null>(null)

const isCategories = computed(() => props.kind === 'categories')
const NO_PARENT = 'none'
const busy = computed(() => save.isPending.value || adding.value || savingId.value !== null)
const locked = computed(() => !hydrated.value || !props.canEdit || busy.value)
const parentOf = (row: HelpdeskResource | HelpdeskCategoryResource) =>
  (row as HelpdeskCategoryResource).parent_id ?? null

const parentItemsFor = (excludeId?: number) => [
  { value: NO_PARENT, label: t('helpdesk.settings.values.noParent') },
  ...(props.rows as HelpdeskCategoryResource[])
    .filter(row => row.id !== excludeId)
    .map(row => ({ value: String(row.id), label: row.name })),
]

async function addRow() {
  const trimmed = newName.value.trim()
  if (locked.value || !trimmed) return
  failure.value = null
  adding.value = true
  try {
    await save.mutateAsync({
      name: trimmed,
      ...(isCategories.value ? { parent_id: newParentId.value ?? false } : {}),
    })
    newName.value = ''
    newParentId.value = null
  } catch (cause) {
    failure.value = saveErrorMessage(cause, t('helpdesk.settings.resources.failed'), t('errors.saveUncertain'))
  } finally {
    adding.value = false
  }
}

async function renameRow(row: HelpdeskResource | HelpdeskCategoryResource, name: string) {
  const trimmed = name.trim()
  if (locked.value || !trimmed || trimmed === row.name) return
  failure.value = null
  savingId.value = row.id
  try {
    await save.mutateAsync({
      id: row.id,
      name: trimmed,
      ...(isCategories.value ? { parent_id: parentOf(row) ?? false } : {}),
    })
  } catch (cause) {
    failure.value = saveErrorMessage(cause, t('helpdesk.settings.resources.failed'), t('errors.saveUncertain'))
  } finally {
    savingId.value = null
  }
}

async function changeParent(row: HelpdeskResource | HelpdeskCategoryResource, value: unknown) {
  const next = value === NO_PARENT ? null : Number(value)
  if (locked.value || !row.active || next === parentOf(row)) return
  failure.value = null
  savingId.value = row.id
  try {
    await save.mutateAsync({ id: row.id, name: row.name, parent_id: next ?? false })
  } catch (cause) {
    failure.value = saveErrorMessage(cause, t('helpdesk.settings.resources.failed'), t('errors.saveUncertain'))
  } finally {
    savingId.value = null
  }
}

async function archive(row: HelpdeskResource | HelpdeskCategoryResource, active: boolean) {
  if (locked.value) return
  failure.value = null
  savingId.value = row.id
  try {
    await save.mutateAsync({ id: row.id, name: row.name, active })
  } catch (cause) {
    failure.value = saveErrorMessage(cause, t('helpdesk.settings.resources.failed'), t('errors.saveUncertain'))
  } finally {
    savingId.value = null
  }
}

const title = computed(() => t(`helpdesk.settings.values.${props.kind}.title`))
</script>

<template>
  <SharedSettingsList
    :id="`helpdesk-${props.kind}`"
    :data-testid="`helpdesk-settings-${props.kind}`"
    :title="title"
    :can-edit="canEdit"
    :message="failure ?? ''"
    :empty="!props.rows.length"
    :adding="adding"
    :add-disabled="busy || !newName.trim()"
    @add="addRow"
  >
    <SharedSettingsListRow
      v-for="row in props.rows"
      :key="row.id"
      :name="row.name"
      :active="row.active"
      :can-edit="canEdit"
      :busy="busy"
      :maxlength="64"
      :data-testid="`helpdesk-${props.kind}-${row.id}`"
      @rename="name => renameRow(row, name)"
      @toggle="active => archive(row, active)"
    >
      <USelect
        v-if="isCategories"
        :model-value="parentOf(row) === null ? NO_PARENT : String(parentOf(row))"
        :items="parentItemsFor(row.id)"
        class="min-w-40"
        :aria-label="t('helpdesk.settings.values.parent')"
        :disabled="locked || !row.active"
        @update:model-value="value => changeParent(row, value)"
      />
    </SharedSettingsListRow>
    <template #add>
      <UInput
        v-model="newName"
        class="min-w-40 flex-1"
        :placeholder="t('app.list.newName')"
        :aria-label="t('helpdesk.settings.resources.name')"
        :maxlength="64"
        :disabled="locked"
        :data-testid="`helpdesk-${props.kind}-name`"
      />
      <USelect
        v-if="isCategories"
        :model-value="newParentId === null ? NO_PARENT : String(newParentId)"
        :items="parentItemsFor()"
        class="min-w-40"
        :aria-label="t('helpdesk.settings.values.parent')"
        :disabled="locked"
        @update:model-value="value => { newParentId = value === NO_PARENT ? null : Number(value) }"
      />
    </template>
  </SharedSettingsList>
</template>
