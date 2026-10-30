<script setup lang="ts">
import PersonalSummaryCard from '@/components/account/PersonalSummaryCard.vue'
import { usePersonalOverview } from '@/composables/usePersonalOverview'
import { usePersonalOrder } from '@/composables/usePersonalOrder'
const { t } = useI18n()
const { me } = useMe()
const hydrated = useHydrated()
const { cards, attention } = usePersonalOverview()
const customize = ref(false)
const { order, move, failed } = usePersonalOrder(() => cards.value.map(card => card.entry.id))
const orderedCards = computed(() => order.value.flatMap(id => cards.value.filter(card => card.entry.id === id)))
const profile = computed(() => cards.value.find(card => card.entry.section === 'profile'))
</script>

<template>
  <SharedPageContainer width="list" data-testid="personal-overview">
    <SharedPageHeader :title="t('nav.account')" icon="i-lucide-user-round">
      <template #actions><UButton v-if="cards.length > 1" color="neutral" variant="outline" icon="i-lucide-sliders-horizontal" :label="t(customize ? 'account.finishCustomize' : 'account.customize')" :disabled="!hydrated" :aria-pressed="customize" @click="customize = !customize" /></template>
    </SharedPageHeader>
    <p class="text-sm text-muted">{{ t('account.subtitle') }}</p>
    <SharedIdentityCard v-if="me" :id="me.id" :name="me.name" :subtitle="profile?.data?.value || me.company.name">
      <template #badge><UButton v-if="profile" :to="profile.entry.to" color="neutral" variant="link" size="sm" :label="t('account.viewProfile')" :disabled="!hydrated" /></template>
    </SharedIdentityCard>
    <SharedRecordSection v-if="attention.length" variant="panel" :title="t('account.attention')">
      <ul class="divide-y divide-default">
        <li v-for="row in attention" :key="row.id" class="py-3">
          <NuxtLink :to="row.to" class="block rounded focus-visible:ring-2 focus-visible:ring-primary">
            <p class="font-medium text-highlighted">{{ row.label }}</p>
            <p v-if="row.caption" class="mt-1 text-sm text-muted">{{ row.caption }}</p>
          </NuxtLink>
        </li>
      </ul>
    </SharedRecordSection>
    <UAlert v-if="failed" color="warning" :title="t('account.preferenceError')" />
    <div v-if="cards.length" class="grid gap-(--liwan-gap-card) lg:grid-cols-2">
      <PersonalSummaryCard v-for="(card, index) in orderedCards" :key="card.entry.id" :entry="card.entry" :data="card.data" :pending="card.pending" :error="card.error" :action="card.action" :customize="customize" :first="index === 0" :last="index === orderedCards.length - 1" @retry="card.retry" @move="move(card.entry.id, $event)" />
    </div>
    <SharedEmptyState v-else bordered :title="t('account.noServices')" :description="t('account.noServicesHint')" />
    <UButton to="/account/settings" color="neutral" variant="outline" icon="i-lucide-settings-2" :label="t('account.settings')" :disabled="!hydrated" class="self-start" />
  </SharedPageContainer>
</template>
