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

const revisions = ref<Record<number, number>>({})
const newName = ref('')
const newSeverity = ref<number | undefined>(1)
const savingId = ref<number | null>(null)
const failure = ref<unknown>(null)
const reloading = ref(false)
const reloadGeneration = ref(0)

const rows = computed(() => sortHrWarningTypes(props.types))
const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
const busy = computed(() => create.isPending.value || savingId.value !== null || reloading.value || conflict.value)
const locked = computed(() => !hydrated.value || !props.canEdit || busy.value)
const message = computed(() => failure.value ? (conflict.value ? t('hrWarnings.types.conflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))) : '')

function validSeverity(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000
}
function captureRevision(type: HrWarningType) {
  if (revisions.value[type.id] === undefined) {
    revisions.value = { ...revisions.value, [type.id]: type.revision }
  }
}
function clearRevision(id: number) {
  if (revisions.value[id] === undefined) return
  const { [id]: _cleared, ...rest } = revisions.value
  revisions.value = rest
}
function releaseRevision(id: number, event?: FocusEvent) {
  if (event?.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
  if (savingId.value !== id && !conflict.value) clearRevision(id)
}

async function run(id: number | null, action: () => Promise<unknown>) {
  if (locked.value) return
  failure.value = null
  savingId.value = id
  try {
    await action()
  } catch (error) { failure.value = error } finally { savingId.value = null }
}
async function saveName(type: HrWarningType, name: string) {
  const trimmed = name.trim()
  if (!trimmed || trimmed === type.name) return
  const revision = revisions.value[type.id] ?? type.revision
  await run(type.id, async () => {
    await patch.mutateAsync({ id: type.id, body: { revision, name: trimmed, severity: type.severity } })
    clearRevision(type.id)
  })
}
async function saveSeverity(type: HrWarningType, severity: number | null | undefined) {
  if (!validSeverity(severity) || severity === type.severity) return
  const revision = revisions.value[type.id] ?? type.revision
  await run(type.id, async () => {
    await patch.mutateAsync({ id: type.id, body: { revision, name: type.name, severity } })
    clearRevision(type.id)
  })
}
async function setActive(type: HrWarningType, active: boolean) {
  await run(type.id, async () => {
    await patch.mutateAsync({ id: type.id, body: { revision: type.revision, active } })
    clearRevision(type.id)
  })
}
async function addType() {
  const name = newName.value.trim()
  if (!name || !validSeverity(newSeverity.value)) return
  const severity = newSeverity.value
  await run(null, async () => {
    await create.mutateAsync({ name, severity })
    newName.value = ''
  })
}
async function reload() {
  if (reloading.value) return
  reloading.value = true
  try {
    await props.reloadTypes()
    revisions.value = {}
    failure.value = null
    reloadGeneration.value += 1
  } catch (error) { failure.value = error } finally { reloading.value = false }
}
</script>

<template>
  <SharedSettingsList
    id="warning-types"
    data-testid="hr-warning-types"
    :title="t('hrWarnings.types.title')"
    :description="t('hrWarnings.types.hint')"
    :can-edit="canEdit"
    :message="message"
    :empty="!rows.length"
    :adding="create.isPending.value"
    :add-disabled="busy || !newName.trim() || !validSeverity(newSeverity)"
    @add="addType"
  >
    <template v-if="conflict" #before>
      <UButton
        class="justify-self-start"
        color="neutral"
        variant="outline"
        :label="t('hrWarnings.types.reload')"
        :loading="reloading"
        :disabled="!hydrated || reloading"
        data-testid="hr-warning-types-reload"
        @click="reload"
      />
    </template>
    <SharedSettingsListRow
      v-for="type in rows"
      :key="`${type.id}-${reloadGeneration}`"
      :name="type.name"
      :active="type.active"
      :can-edit="canEdit"
      :busy="busy"
      :data-testid="`hr-warning-type-${type.id}`"
      @focusin="captureRevision(type)"
      @focusout="releaseRevision(type.id, $event)"
      @rename="name => saveName(type, name)"
      @toggle="active => setActive(type, active)"
    >
      <UInputNumber
        class="w-28"
        :model-value="type.severity"
        :min="1"
        :max="1000"
        :step="1"
        :aria-label="t('hrWarnings.types.severity')"
        :disabled="locked || !type.active"
        @update:model-value="saveSeverity(type, $event)"
      />
    </SharedSettingsListRow>
    <template #add>
      <UInput
        v-model="newName"
        class="min-w-40 flex-1"
        :placeholder="t('hrWarnings.types.namePlaceholder')"
        :aria-label="t('hrWarnings.types.name')"
        :maxlength="200"
        :disabled="!hydrated || busy"
      />
      <UInputNumber
        v-model="newSeverity"
        class="w-28"
        :min="1"
        :max="1000"
        :step="1"
        :aria-label="t('hrWarnings.types.severity')"
        :disabled="!hydrated || busy"
      />
    </template>
  </SharedSettingsList>
</template>
