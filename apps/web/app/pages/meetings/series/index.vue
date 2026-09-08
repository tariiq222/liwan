<script setup lang="ts">
import { Plus } from '@lucide/vue'
import { useMeetingSeriesList } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const query = useMeetingSeriesList({})
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('nav.meetingSeries')">
      <template #actions>
        <NuxtLink v-if="can('meetings.create')" :to="{ path: '/meetings/series/new', query: returnToQuery(route.fullPath) }">
          <Button :disabled="!hydrated" class="gap-2">
            <Plus class="size-[18px]" />{{ t('meetingsUi.newSeries') }}
          </Button>
        </NuxtLink>
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value?.items.length" :empty-text="t('meetingsUi.emptySeries')" @retry="query.refetch">
      <div class="nasq-panel overflow-hidden">
        <NuxtLink
          v-for="series in query.data.value?.items"
          :key="series.id"
          :to="{ path: `/meetings/series/${series.id}`, query: returnToQuery(route.fullPath) }"
          class="flex items-center gap-3 border-b border-border/80 p-3 last:border-0 hover:bg-muted/70"
        >
          <span class="font-medium">{{ series.name }}</span>
          <span class="ms-auto text-sm text-muted-foreground">
            {{ t(`meetingsUi.recurrence.${series.recurrence}`) }}
            · {{ t('meetingsUi.openCount', { count: series.open_resolution_count }) }}
          </span>
        </NuxtLink>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
