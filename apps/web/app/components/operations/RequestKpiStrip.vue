<script setup lang="ts">
import { operationPurposeFromSelection } from '@/composables/operations/forms'
import { useOperationKpis } from '@/composables/operations/useOperationKpis'
import type { OperationScope } from '@/composables/operations/useOperations'

// The figures above one of the request lists: totals from the list API per state, under the list's own scope, type filter and search.
const props = defineProps<{ scope: OperationScope }>()
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const allowed = computed(() => can(props.scope === 'pending' ? 'operations.requests.read' : props.scope === 'monitoring' ? 'operations.monitoring.read' : 'operations.requests.read'))
const search = computed(() => typeof route.query.q === 'string' ? route.query.q : undefined)
const purpose = computed(() => props.scope === 'mine' ? undefined : operationPurposeFromSelection(route.query.purpose))
const { tiles, loading } = useOperationKpis(props.scope, search, purpose, allowed)
</script>

<template>
  <SharedKpiStrip v-if="allowed" :tiles="tiles" :loading="loading" :label="t('operations.kpi.label')" :data-testid="`operation-kpi-strip-${scope}`" />
</template>
