<script setup lang="ts">
import type { FinanceZatcaJournal } from '@webvue/contracts'
import ZatcaOnboardForm from './ZatcaOnboardForm.vue'
import { ZATCA_JOURNAL_TONE } from './zatcaOnboarding'

// The sales journals with their onboarding state; a journal that is not onboarded opens the inline onboarding form for a user who may manage it.
defineProps<{ journals: FinanceZatcaJournal[] }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('finance.zatca.manage'))
const openJournal = ref<number | null>(null)
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('financeGovernance.zatca.journals.title')" :description="t('financeGovernance.zatca.journals.hint')" data-testid="finance-zatca-journals">
    <SharedEmptyState v-if="!journals.length" :title="t('financeGovernance.zatca.journals.empty')" />
    <ul v-else class="divide-y divide-default">
      <li v-for="item in journals" :key="item.journal.id" class="py-3 first:pt-0 last:pb-0" :data-testid="`finance-zatca-journal-${item.journal.id}`">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="min-w-0 truncate font-semibold text-highlighted"><bdi>{{ item.journal.name }}</bdi></span>
          <span class="flex items-center gap-2">
            <SharedStatusBadge size="sm" :tone="ZATCA_JOURNAL_TONE[item.state]" :label="t(`financeGovernance.zatca.states.${item.state}`)" />
            <UButton v-if="canManage && !item.onboarded && openJournal !== item.journal.id" size="xs" variant="soft" icon="i-lucide-key-round" :disabled="!hydrated" :label="t('financeGovernance.zatca.onboard.start')" @click="openJournal = item.journal.id" />
          </span>
        </div>
        <ZatcaOnboardForm v-if="canManage && !item.onboarded && openJournal === item.journal.id" class="mt-3" :journal="item.journal" @done="openJournal = null" @cancel="openJournal = null" />
      </li>
    </ul>
  </SharedRecordSection>
</template>
