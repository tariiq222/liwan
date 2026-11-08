<script setup lang="ts">
/*
 * One card of a settings page (DESIGN.md §6): the panel card with a stable anchor `id` and its fields as horizontal rows
 * (`.liwan-setting-rows`). Inside a settings page the card has no footer of its own: it registers with the page's
 * `useSettingsSave` registry and the page's one `SharedSettingsSaveBar` saves and reverts every edited card, so the card
 * only shows an «Unsaved» badge while it has edits. Outside a settings page, and for an action card with its own `saveLabel`
 * (applying a preset, which needs its own confirm), the card keeps its footer of «Revert» and «Save changes».
 * A viewer who may not edit sees the same fields disabled, a «View only» badge and no footer. A failed save shows inside
 * the card; a 409 locks the card until the manager reloads the current values, so a stale draft never overwrites a change
 * made elsewhere. The state comes from the page's form composable; the card only draws it. UForm's own submit loading is
 * off: it would disable every field for a tick, so a card could not move focus to its first invalid field.
 */
import { reactive, watch, watchEffect } from 'vue'
import { useSettingsSaveRegistry, type SettingsSaveEntry } from '../../../composables/useSettingsSave'

const props = withDefaults(defineProps<{
  id: string
  title: string
  description?: string
  canEdit: boolean
  dirty?: boolean
  saving?: boolean
  reloading?: boolean
  conflict?: boolean
  /** The failure message of the last save, empty when it succeeded. */
  message?: string
  reloadFailed?: boolean
  /** The card's own button label: an action card that keeps its footer and its own confirm. */
  saveLabel?: string
  /**
   * The card's save (`@save`), a prop rather than an event so the page bar can await it: the cards of one settings
   * object share a revision, so the bar saves them one after another, each with the revision the previous save returned.
   */
  onSave?: () => unknown
}>(), { dirty: false, saving: false, reloading: false, conflict: false, message: '', reloadFailed: false })
const emit = defineEmits<{ revert: []; reload: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const busy = computed(() => !hydrated.value || props.saving || props.reloading)
// Resolves once the card's save handler returned and its `saving` state settled, so the next card starts afterwards.
async function runSave() {
  await props.onSave?.()
  if (!props.saving) return
  await new Promise<void>((done) => {
    const stop = watch(() => props.saving, (saving) => {
      if (saving) return
      stop()
      done()
    })
  })
}
const registry = useSettingsSaveRegistry()
// An action card with its own label owns its button and confirm, so it keeps its footer even inside a settings page.
const managed = Boolean(registry) && !props.saveLabel
const entry = reactive<SettingsSaveEntry>({
  id: props.id,
  dirty: props.dirty,
  saving: props.saving,
  conflict: props.conflict,
  failed: Boolean(props.message),
  submit: runSave,
  revert: () => emit('revert'),
})
if (managed && registry) onBeforeUnmount(registry.register(entry))
watchEffect(() => {
  entry.dirty = props.dirty
  entry.saving = props.saving
  entry.conflict = props.conflict
  entry.failed = Boolean(props.message)
})
</script>

<template>
  <UForm novalidate :state="{}" :loading-auto="false" class="liwan-form" method="post" data-slot="settings-card" @submit="runSave">
    <SharedUnsavedChanges :dirty="canEdit && (dirty || saving)" />
    <SharedRecordSection :id="id" variant="panel" class="liwan-settings-anchor" :title="title" :description="description">
      <template v-if="!canEdit || $slots.actions || (managed && dirty)" #actions>
        <slot name="actions" />
        <UBadge v-if="!canEdit" color="neutral" variant="subtle" :label="t('app.viewOnly')" />
        <UBadge v-else-if="managed && dirty" color="warning" variant="subtle" :label="t('app.unsaved')" />
      </template>
      <div class="grid gap-4">
        <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="message" />
        <div v-if="conflict" class="flex flex-wrap items-center gap-3">
          <UButton type="button" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :label="t('app.reloadCurrent')" :loading="reloading" :disabled="busy" @click="emit('reload')" />
        </div>
        <UAlert v-if="reloadFailed" role="alert" color="error" variant="subtle" :title="t('app.reloadFailed')" />
        <div class="liwan-setting-rows"><slot /></div>
      </div>
    </SharedRecordSection>
    <SharedFormActions v-if="!managed && canEdit">
      <UButton type="button" color="neutral" variant="outline" class="ms-auto" :label="t('app.revert')" :disabled="busy || !dirty" @click="emit('revert')" />
      <UButton type="submit" :loading="saving" :disabled="busy || !dirty || conflict" :label="saveLabel ?? t('app.saveChanges')" />
    </SharedFormActions>
  </UForm>
</template>
