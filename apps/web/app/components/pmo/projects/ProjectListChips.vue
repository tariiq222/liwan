<script setup lang="ts">
import { PROJECT_CHIP_IDS, projectChipLabelKey, type ProjectChipId } from '@/utils/projectListChips'

// The presets of the projects list as chips with their counts: all, mine, needing attention, one per status and the
// archived ones. Choosing one replaces the list's mine, status and archived filters; the page writes them to the URL.
const props = defineProps<{
  /** The chip the filters equal, or null for a mix no chip names. */
  selected: ProjectChipId | null
  counts: Partial<Record<ProjectChipId, number>>
  /** The archived chip belongs to managers (the server's can_list_archived). */
  archivedAvailable: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ select: [chip: ProjectChipId] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const chips = computed(() => PROJECT_CHIP_IDS.filter(chip => chip !== 'archived' || props.archivedAvailable))
</script>

<template>
  <div role="group" :aria-label="t('projects.filters.chipsLabel')" class="flex flex-wrap gap-1.5" data-testid="projects-chips">
    <UButton
      v-for="chip in chips"
      :key="chip"
      type="button"
      size="sm"
      :color="props.selected === chip ? 'primary' : 'neutral'"
      :variant="props.selected === chip ? 'solid' : 'soft'"
      class="h-9 rounded-control"
      :aria-pressed="props.selected === chip"
      :disabled="props.disabled || !hydrated"
      :data-testid="`projects-chip-${chip}`"
      @click="emit('select', chip)"
    >
      <span>{{ t(projectChipLabelKey(chip)) }}</span>
      <span v-if="props.counts[chip] !== undefined" dir="ltr" class="tabular-nums opacity-80" data-slot="chip-count">{{ props.counts[chip] }}</span>
    </UButton>
  </div>
</template>
