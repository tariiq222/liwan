<script setup lang="ts">
import { committedName } from '../../../utils/settingsListName'

/*
 * One row of a SharedSettingsList: the name, renamed in place and saved when the input commits; the row's own
 * controls in the default slot; its state (archived, protected) as pill badges; and «Archive»/«Restore». An emptied
 * name gets the stored name back, so the row never shows a name the server does not hold.
 */
const props = withDefaults(defineProps<{
  name: string
  active?: boolean
  /** A value the system needs: it cannot be renamed or archived. */
  locked?: boolean
  canEdit: boolean
  /** The row is saving, or the list is busy. */
  busy?: boolean
  /** Archiving is refused for a reason of the row's own (the won stage). */
  archiveDisabled?: boolean
  maxlength?: number
}>(), { active: true, locked: false, busy: false, archiveDisabled: false, maxlength: 200 })
const emit = defineEmits<{ rename: [name: string]; toggle: [active: boolean] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const disabled = computed(() => !hydrated.value || !props.canEdit || props.busy)

function commit(event: Event) {
  const name = committedName(event.target as HTMLInputElement, props.name)
  if (name) emit('rename', name)
}
</script>

<template>
  <li class="flex flex-wrap items-center gap-2" data-slot="settings-list-row">
    <UInput :model-value="name" class="min-w-40 flex-1" :aria-label="t('app.list.name')" :maxlength="maxlength" :disabled="disabled || !active || locked" @change="commit" />
    <slot />
    <UBadge v-if="locked" color="neutral" variant="subtle" class="rounded-full" :label="t('app.list.protected')" />
    <UBadge v-else-if="!active" color="neutral" variant="outline" class="rounded-full" :label="t('app.list.archived')" />
    <UButton
      v-if="canEdit && !locked"
      type="button"
      color="neutral"
      variant="outline"
      size="sm"
      :label="active ? t('app.list.archive') : t('app.list.restore')"
      :disabled="disabled || archiveDisabled"
      @click="emit('toggle', !active)"
    />
  </li>
</template>
