<script setup lang="ts">
import type { AppCardModel } from '@/composables/useAppCards'

// One application on the all-applications page: its tile, name and tagline, a pin for the sidebar (an application the
// sidebar always shows takes none) and the button that opens it.
const props = defineProps<{ card: AppCardModel; description?: string; pinned?: boolean; pinDisabled?: boolean }>()
const emit = defineEmits<{ togglePin: [] }>()
const { t } = useI18n()
const id = useId()
</script>

<template>
  <article :data-app="props.card.id" :aria-labelledby="`${id}-title`" class="group flex min-w-0 items-center gap-3.5 rounded-card border-[1.5px] border-default bg-default px-4 py-3.5 transition duration-200 hover:-translate-y-0.5 hover:border-accented hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0" data-testid="launcher-row">
    <span class="liwan-app-tile size-[3.14rem] shrink-0 transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none" aria-hidden="true"><UIcon :name="props.card.icon" class="size-5.5" /></span>
    <div class="min-w-0 flex-1">
      <h3 :id="`${id}-title`" class="text-base font-semibold text-highlighted">{{ t(props.card.labelKey) }}</h3>
      <p v-if="props.description" class="text-xs leading-relaxed text-muted">{{ props.description }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <UTooltip v-if="props.card.pinnable" :text="t(props.pinDisabled && !props.pinned ? 'launcher.pinLimit' : props.pinned ? 'launcher.unpin' : 'launcher.pin')">
        <UButton type="button" square size="sm" color="neutral" :variant="props.pinned ? 'soft' : 'ghost'" :icon="props.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'" :disabled="props.pinDisabled" data-testid="launcher-pin" :aria-pressed="props.pinned" :aria-label="`${t(props.pinned ? 'launcher.unpin' : 'launcher.pin')}: ${t(props.card.labelKey)}`" @click="emit('togglePin')" />
      </UTooltip>
      <UButton :to="props.card.to" size="sm" color="neutral" variant="soft" data-testid="launcher-open" :aria-label="`${t('launcher.open')}: ${t(props.card.labelKey)}`">{{ t('launcher.openShort') }}</UButton>
    </div>
  </article>
</template>
