<script setup lang="ts">
/*
 * One card of a settings page (DESIGN.md §6): the panel card with a stable anchor `id`, its fields as horizontal rows
 * (`.liwan-setting-rows`), and one footer with «Revert» and «Save changes». A viewer who may not edit sees the same
 * fields disabled, a «View only» badge and no footer. A failed save shows inside the card; a 409 locks the card until
 * the manager reloads the current values, so a stale draft never overwrites a change made elsewhere.
 * The state comes from the page's form composable; the card only draws it. UForm's own submit loading is off: it would
 * disable every field for a tick, so a card could not move focus to its first invalid field.
 */
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
  saveLabel?: string
}>(), { dirty: false, saving: false, reloading: false, conflict: false, message: '', reloadFailed: false })
defineEmits<{ save: []; revert: []; reload: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const busy = computed(() => !hydrated.value || props.saving || props.reloading)
</script>

<template>
  <UForm novalidate :state="{}" :loading-auto="false" class="liwan-form" method="post" data-slot="settings-card" @submit="$emit('save')">
    <SharedUnsavedChanges :dirty="canEdit && (dirty || saving)" />
    <SharedRecordSection :id="id" variant="panel" class="liwan-settings-anchor" :title="title" :description="description">
      <template v-if="!canEdit || $slots.actions" #actions>
        <slot name="actions" />
        <UBadge v-if="!canEdit" color="neutral" variant="subtle" class="rounded-full" :label="t('app.viewOnly')" />
      </template>
      <div class="grid gap-4">
        <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="message" />
        <div v-if="conflict" class="flex flex-wrap items-center gap-3">
          <UButton type="button" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :label="t('app.reloadCurrent')" :loading="reloading" :disabled="busy" @click="$emit('reload')" />
        </div>
        <UAlert v-if="reloadFailed" role="alert" color="error" variant="subtle" :title="t('app.reloadFailed')" />
        <div class="liwan-setting-rows"><slot /></div>
      </div>
    </SharedRecordSection>
    <SharedFormActions v-if="canEdit">
      <UButton type="button" color="neutral" variant="outline" class="ms-auto" :label="t('app.revert')" :disabled="busy || !dirty" @click="$emit('revert')" />
      <UButton type="submit" :loading="saving" :disabled="busy || !dirty || conflict" :label="saveLabel ?? t('app.saveChanges')" />
    </SharedFormActions>
  </UForm>
</template>
