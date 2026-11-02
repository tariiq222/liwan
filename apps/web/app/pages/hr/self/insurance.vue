<script setup lang="ts">
definePageMeta({ path: '/account/insurance' })
import OwnInsuranceCard from '@/components/hr/insurance/OwnInsuranceCard.vue'

// The employee's own medical insurance: read-only. Management records are never linked from here.
const { t } = useI18n()

const profile = useMyHrProfile()
const mine = useMyHrInsurance(computed(() => !!profile.data.value))
const hydrated = useHydrated()
const items = computed(() => (mine.data.value?.pages ?? []).flatMap(page => page.items))
const total = computed(() => mine.data.value?.pages.at(-1)?.total ?? 0)
const showEmpty = computed(() => !mine.isLoading.value && !mine.error.value && items.value.length === 0)
</script>

<template>
  <SharedListPage :title="t('nav.myInsurance')">
    <SharedPageState :loading="profile.isLoading.value" :error="profile.error.value" @retry="profile.refetch">
      <SharedEmptyState v-if="profile.data.value === null" bordered :title="t('hr.self.noEmployee')" :description="t('hr.self.noEmployeeHint')" />
    </SharedPageState>
    <SharedPageState v-if="profile.data.value" :loading="mine.isLoading.value" :error="mine.error.value" :keep-content="items.length > 0" @retry="mine.refetch">
      <SharedEmptyState v-if="showEmpty" bordered :title="t('hrInsurance.own.emptyTitle')" :description="t('hrInsurance.own.emptyHint')" />
      <div v-else class="liwan-page-stack" data-testid="hr-my-insurance">
        <OwnInsuranceCard v-for="enrollment in items" :key="enrollment.id" :enrollment="enrollment" />
        <div class="flex flex-col items-center gap-2">
          <p class="text-sm text-muted" data-testid="hr-my-insurance-count">{{ t('hrInsurance.footer', { shown: items.length, total }, total) }}</p>
          <UButton v-if="mine.hasNextPage.value" color="neutral" variant="outline" :disabled="!hydrated || mine.isFetchingNextPage.value" :loading="mine.isFetchingNextPage.value" :label="t('app.loadMore')" data-testid="hr-my-insurance-more" @click="mine.fetchNextPage()" />
        </div>
      </div>
    </SharedPageState>
  </SharedListPage>
</template>
