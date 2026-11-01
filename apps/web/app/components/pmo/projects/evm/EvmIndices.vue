<script setup lang="ts">
import type { ProjectEvm } from '@liwan/contracts'
import { formatMoney } from '@/utils/projectFinance'
import { formatIndex, indexBadgeTone, indexTone } from './evm'

// CPI and SPI as headline tiles (colour bands), then the amounts and the forecasts. A null figure reads "not enough data".
const props = defineProps<{ evm: ProjectEvm }>()
const { t, locale } = useI18n()
const unknown = computed(() => t('projects.evm.notEnough'))
const money = (value: number | null) => value === null || !props.evm.currency ? unknown.value : formatMoney(value, props.evm.currency)
const rows = computed(() => [
  ['bac', props.evm.bac], ['pv', props.evm.pv], ['ev', props.evm.ev], ['ac', props.evm.ac], ['sv', props.evm.sv], ['cv', props.evm.cv],
  ['eac', props.evm.eac], ['etc', props.evm.etc], ['vac', props.evm.vac], ['tcpi', props.evm.tcpi],
] as const)
const isIndex = (key: string) => key === 'tcpi'
</script>

<template>
  <div class="space-y-(--liwan-gap-card)">
    <div class="grid gap-(--liwan-gap-card) sm:grid-cols-2">
      <SharedMetricTile
        v-for="[key, icon, value] in ([['spi', 'i-lucide-calendar-clock', evm.spi], ['cpi', 'i-lucide-wallet', evm.cpi]] as const)"
        :key="key"
        density="compact"
        :icon="icon"
        :tone="indexTone(value)"
        :label="t(`projects.evm.indices.${key}`)"
        :value="formatIndex(value, unknown, locale)"
        value-dir="ltr"
        :hint="t(`projects.evm.indices.${key}Hint`)"
        :data-testid="`evm-${key}`"
        :data-band="indexTone(value)"
      >
        <SharedStatusBadge v-if="value !== null" class="mt-1 w-fit" size="sm" :tone="indexBadgeTone(value)" :label="t(`projects.evm.bands.${indexTone(value)}`)" />
      </SharedMetricTile>
    </div>
    <SharedPropertiesPanel data-testid="evm-figures">
      <SharedPropertyRow v-for="[key, value] in rows" :key="key" :label="t(`projects.evm.figures.${key}`)">
        <span dir="ltr" class="tabular-nums" :data-testid="`evm-${key}`">{{ isIndex(key) ? formatIndex(value, unknown, locale) : money(value) }}</span>
      </SharedPropertyRow>
    </SharedPropertiesPanel>
  </div>
</template>
