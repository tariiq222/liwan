<script setup lang="ts">
/*
 * A settings card that holds a list of values (sources, reasons, stages, packages): the panel card with a stable anchor
 * `id`, the rows (`SharedSettingsListRow`) in the default slot, and an add form whose fields go in `#add`. Each row
 * saves on its own, so the card has no footer; a failed save shows once at the top. A viewer who may not edit sees the
 * rows disabled, a «View only» badge and no add form.
 */
const props = withDefaults(defineProps<{
  id: string
  title: string
  description?: string
  canEdit: boolean
  /** The failure message of the last row or add save, empty when it succeeded. */
  message?: string
  empty?: boolean
  loading?: boolean
  /** The list failed to load (it shows with a retry in place of the rows). */
  error?: unknown
  adding?: boolean
  /** The add form has nothing valid to add yet. */
  addDisabled?: boolean
}>(), { message: '', empty: false, loading: false, error: undefined, adding: false, addDisabled: false })
defineEmits<{ add: []; retry: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <SharedRecordSection :id="id" variant="panel" class="liwan-settings-anchor" data-slot="settings-list" :title="title" :description="description">
    <template v-if="!canEdit || $slots.actions" #actions>
      <slot name="actions" />
      <UBadge v-if="!canEdit" color="neutral" variant="subtle" class="rounded-full" :label="t('app.viewOnly')" />
    </template>
    <SharedPageState :loading="props.loading" :error="props.error" :empty="false" @retry="$emit('retry')">
      <div class="grid gap-4">
        <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="message" />
        <slot name="before" />
        <p v-if="empty" class="text-sm text-muted">{{ t('app.list.empty') }}</p>
        <ul v-else class="grid gap-2"><slot /></ul>
        <form v-if="canEdit && $slots.add" class="flex flex-wrap items-center gap-2 border-t border-default pt-4" novalidate @submit.prevent="$emit('add')">
          <slot name="add" />
          <UButton type="submit" icon="i-lucide-plus" :label="t('app.list.add')" :loading="props.adding" :disabled="!hydrated || props.adding || props.addDisabled" />
        </form>
      </div>
    </SharedPageState>
  </SharedRecordSection>
</template>
