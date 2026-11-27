<script setup lang="ts">
import { cadenceLabel, formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import type { AvailableAddonModel, CatalogPrice } from '@/composables/useAvailableAddons'

// One sellable add-on on the all-applications page: its identity tile, title, description, live catalog pricing, and
// (for billing managers) the button that opens `/subscription/change` with this bundle pre-selected.
const props = defineProps<{ addon: AvailableAddonModel; canManage?: boolean; actionPending?: boolean }>()
const { t, te, locale } = useI18n()
const id = useId()
const title = computed(() => (
  props.addon.labelKey && te(props.addon.labelKey)
    ? t(props.addon.labelKey)
    : (locale.value.startsWith('ar') ? props.addon.nameAr : props.addon.nameEn)
))
const description = computed(() => (
  props.addon.descriptionKey && te(props.addon.descriptionKey)
    ? t(props.addon.descriptionKey)
    : props.addon.fallbackDescription
))
const formatPrice = (price: CatalogPrice) => `${formatCommercialMoney(price.amount, locale.value)} · ${cadenceLabel(price.cadence, t)}`
</script>

<template>
  <article :data-app="props.addon.appId" :aria-labelledby="`${id}-title`" class="group flex min-w-0 items-center gap-3.5 rounded-card border-[1.5px] border-default bg-default px-4 py-3.5 liwan-lift" data-testid="launcher-addon-row">
    <span class="liwan-app-tile size-[3.14rem] shrink-0 transition-transform duration-(--liwan-motion-panel) ease-(--liwan-motion-ease) group-hover:scale-105" aria-hidden="true"><UIcon :name="props.addon.icon" class="size-5.5" /></span>
    <div class="min-w-0 flex-1">
      <h3 :id="`${id}-title`" class="text-base font-semibold text-highlighted">{{ title }}</h3>
      <p v-if="description" class="text-xs leading-relaxed text-muted">{{ description }}</p>
      <p class="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs" data-testid="launcher-addon-price">
        <span class="font-medium text-default">{{ formatPrice(props.addon.primaryPrice) }}</span>
        <template v-if="props.addon.secondaryPrice">
          <span aria-hidden="true" class="text-muted">·</span>
          <span class="text-muted">{{ formatPrice(props.addon.secondaryPrice) }}</span>
        </template>
      </p>
    </div>
    <div v-if="props.canManage" class="flex shrink-0 items-center gap-2">
      <UButton
        :to="{ path: '/subscription/change', query: { add: props.addon.bundleId } }"
        size="sm"
        color="neutral"
        variant="outline"
        icon="i-lucide-plus"
        :disabled="props.actionPending"
        data-testid="launcher-addon-upgrade"
        :aria-label="`${t('launcher.available.addAction')}: ${title}`"
      >{{ t('launcher.available.addShort') }}</UButton>
    </div>
  </article>
</template>
