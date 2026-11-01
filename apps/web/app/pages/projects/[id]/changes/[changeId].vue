<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { CHANGE_STATE_TONE } from '@/components/pmo/projects/changes/state'
import ChangeDecisionPanel from '@/components/pmo/projects/changes/ChangeDecisionPanel.vue'
import { formatLiwanDate } from '@liwan/ui/app/composables/calendarDate'
import { useProjectChange } from '@/composables/useProjectChanges'
import { formatMoney } from '@/utils/projectFinance'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => Number(route.params.id))
const changeId = computed(() => Number(route.params.changeId))
const item = useProjectChange(projectId, changeId)
const listPaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/changes`])
const backTo = computed(() => owningListBack(route.query, listPaths.value, route.hash))
const editTo = computed(() => recordChildTo(`/projects/${projectId.value}/changes/${changeId.value}/edit`, route.query, listPaths.value, route.hash))
const hydrated = useHydrated()
const detailPath = computed(() => `/projects/${projectId.value}/changes/${changeId.value}`)
const days = (value: number) => value === 0 ? '0' : `${value > 0 ? '+' : '−'}${Math.abs(value)}`
</script>

<template>
  <SharedRecordPage
    v-if="route.path.replace(/\/+$/, '') === detailPath"
    :keep-content="!!item.data.value"
    :title="item.data?.value?.title ?? t('projects.changes.title')"
    :back-to="backTo"
    :back-label="t('projects.changes.title')"
    :loading="item.isLoading.value"
    :error="item.error.value"
    @retry="item.refetch"
  >
    <template v-if="item.data?.value?.can_edit && hydrated" #actions>
      <UButton data-testid="change-detail-edit" :to="editTo">{{ t('app.edit') }}</UButton>
    </template>
    <SharedEmptyState v-if="!item.data?.value" :title="t('app.noResults')" />
    <template v-else>
      <ChangeDecisionPanel :item="item.data.value" />
      <SharedRecordSection variant="panel" :title="t('projects.changes.fields.description')">
        <p class="whitespace-pre-wrap text-sm">{{ item.data.value.description || '—' }}</p>
      </SharedRecordSection>
      <SharedRecordSection variant="panel" :title="t('projects.changes.fields.reason')">
        <p class="whitespace-pre-wrap text-sm">{{ item.data.value.reason || '—' }}</p>
      </SharedRecordSection>
      <SharedRecordSection variant="panel" :title="t('projects.changes.form.impactTitle')">
        <p class="whitespace-pre-wrap text-sm">{{ item.data.value.impact_scope || '—' }}</p>
      </SharedRecordSection>
    </template>
    <template v-if="item.data?.value" #summary>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('projects.changes.fields.state')">
          <SharedStatusBadge :tone="CHANGE_STATE_TONE[item.data.value.state]" :label="t(`projects.changes.state.${item.data.value.state}`)" />
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.changes.fields.category')" :value="item.data.value.category?.name ?? null" />
        <SharedPropertyRow :label="t('projects.changes.fields.requester')">
          <span class="inline-flex items-center gap-2"><SharedPersonAvatar :people="[item.data.value.requester]" />{{ item.data.value.requester.name }}</span>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.changes.fields.scheduleDays')"><span dir="ltr" class="tabular-nums">{{ days(item.data.value.impact_schedule_days) }}</span></SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.changes.fields.cost')">
          <span dir="ltr" class="tabular-nums">{{ item.data.value.currency ? formatMoney(item.data.value.impact_cost, item.data.value.currency) : item.data.value.impact_cost }}</span>
        </SharedPropertyRow>
        <SharedPropertyRow :label="t('projects.changes.fields.createdAt')" :value="formatLiwanDate(item.data.value.created_at) || null" />
        <SharedPropertyRow v-if="item.data.value.decided_by" :label="t('projects.changes.fields.decidedBy')" :value="item.data.value.decided_by.name" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage />
</template>
