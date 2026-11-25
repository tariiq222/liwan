<script setup lang="ts">
definePageMeta({ path: '/account/requests' })
import RequestList from '@/components/operations/RequestList.vue'
import { personalEntries } from '@/composables/nav/personalModel'
import { useOperationKpis } from '@/composables/operations/useOperationKpis'
const route = useRoute()
const { t } = useI18n()
const { me } = useMe()
const { can } = useAccess()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()
const leave = computed(() => personalEntries(me.value).find(entry => entry.section === 'leave'))
const allowed = computed(() => can('operations.requests.read'))
const search = computed(() => typeof route.query.q === 'string' ? route.query.q.trim() || undefined : undefined)
const kpis = useOperationKpis('mine', search, undefined, computed(() => allowed.value && kpisShown.value), true)
</script>
<template>
  <SharedListPage :title="t('operations.personal.title')" :kpi-toggle="allowed">
    <template #actions><UButton v-if="can('operations.requests.create')" to="/account/requests/new" icon="i-lucide-plus" :label="t('operations.personal.new')" :disabled="!hydrated" /></template>
    <template v-if="allowed" #kpis>
      <SharedKpiStrip :tiles="kpis.tiles.value" :loading="kpis.loading.value" :label="t('operations.kpi.label')" data-testid="operation-kpi-strip-personal" />
    </template>
    <p class="text-sm text-muted">{{ t('operations.personal.description') }}</p>
    <UButton v-if="leave" :to="leave.to" color="neutral" variant="outline" :icon="leave.icon" :label="t('operations.personal.leaveRequests')" :disabled="!hydrated" class="self-start" />
    <RequestList scope="mine" personal />
  </SharedListPage>
</template>
