<script setup lang="ts">
definePageMeta({ path: '/account/warnings' })
import OwnWarningCard from '@/components/hr/warnings/OwnWarningCard.vue'
import { ApiError } from '@/composables/useApi'
import { isHrWarningConflict, ownHrWarningsView } from '@/composables/useHrWarnings'

// The employee's own issued warnings. Answering happens here, inline; administrative records are never linked.
const { t } = useI18n()

const profile = useMyHrProfile()
// Issuing starts here: HR and a direct manager (when the company allows it) get the button, everyone else does not.
const { canIssue } = useHrWarningIssuer()
const mine = useMyHrWarnings(computed(() => !!profile.data.value))
const acknowledge = useAcknowledgeHrWarning()
const contest = useContestHrWarning()
const view = computed(() => ownHrWarningsView(mine.data.value?.pages))
const items = computed(() => view.value.items)
const showEmpty = computed(() => !mine.isLoading.value && !mine.error.value && items.value.length === 0)
const hydrated = useHydrated()
const answering = ref<number | null>(null)
const failure = ref<{ id: number; message: string } | null>(null)

async function answer(id: number, action: () => Promise<unknown>) {
  if (answering.value !== null) return
  answering.value = id
  failure.value = null
  try {
    await action()
  } catch (cause) {
    failure.value = {
      id,
      message: isHrWarningConflict(cause) ? t('hrWarnings.actions.conflict') : cause instanceof ApiError ? cause.message : t('errors.generic'),
    }
  } finally {
    answering.value = null
  }
}
</script>

<template>
  <SharedListPage :title="t('nav.myWarnings')" :create-to="canIssue ? '/hr/warnings/new' : undefined" :create-label="t('hrWarnings.new')" create-test-id="hr-warning-new">
    <SharedPageState :loading="profile.isLoading.value" :error="profile.error.value" @retry="profile.refetch">
      <SharedEmptyState v-if="profile.data.value === null" bordered :title="t('hr.self.noEmployee')" :description="t('hr.self.noEmployeeHint')" />
    </SharedPageState>
    <SharedPageState v-if="profile.data.value" :loading="mine.isLoading.value" :error="mine.error.value" :keep-content="items.length > 0" @retry="mine.refetch">
      <SharedEmptyState v-if="showEmpty" bordered :title="t('hrWarnings.mine.emptyTitle')" :description="t('hrWarnings.mine.emptyHint')" />
      <div v-else class="liwan-page-stack" data-testid="hr-my-warnings">
        <OwnWarningCard
          v-for="warning in items"
          :key="warning.id"
          :warning="warning"
          :pending="answering === warning.id"
          :error="failure?.id === warning.id ? failure.message : undefined"
          @acknowledge="answer(warning.id, () => acknowledge.mutateAsync({ id: warning.id, revision: warning.revision }))"
          @contest="note => answer(warning.id, () => contest.mutateAsync({ id: warning.id, revision: warning.revision, note }))"
        />
        <div class="flex flex-col items-center gap-2">
          <p class="text-sm text-muted" data-testid="hr-my-warnings-count">{{ t('hrWarnings.footer', { shown: items.length, total: view.total }, view.total) }}</p>
          <UButton v-if="mine.hasNextPage.value" color="neutral" variant="outline" :disabled="!hydrated || mine.isFetchingNextPage.value" :loading="mine.isFetchingNextPage.value" :label="t('app.loadMore')" data-testid="hr-my-warnings-more" @click="mine.fetchNextPage()" />
        </div>
      </div>
    </SharedPageState>
  </SharedListPage>
</template>
