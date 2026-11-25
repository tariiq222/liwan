<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { HelpdeskTicketPageSchema, HelpdeskTicketSchema, type HelpdeskTicketRow } from '@liwan/contracts'
import { helpdeskKeys } from '@/composables/helpdesk/helpdeskKeys'

// Merge duplicates into this ticket: search another ticket by its number or subject, tick the ones it absorbs, and the
// server moves their attachments and closes them as duplicates. The section stays on the page, never a dialog.
const props = defineProps<{ ticketId: number }>()
const emit = defineEmits<{ merged: [] }>()
const { t } = useI18n()
const { $api } = useApi()
const qc = useQueryClient()
const hydrated = useHydrated()
const search = ref('')
const term = refDebounced(search, 250)
const selected = ref<number[]>([])
const failure = ref<string | null>(null)
const results = useQuery({
  queryKey: computed(() => [...helpdeskKeys.list({ merge: term.value }), 'merge'] as const),
  queryFn: () => $api('/api/v1/helpdesk/tickets', {
    query: { q: term.value, state: 'all', limit: 8 }, schema: HelpdeskTicketPageSchema,
  }),
})
const rows = computed(() => (results.data.value?.items ?? []).filter(row => row.id !== props.ticketId))
const merge = useMutation({
  mutationFn: (sourceIds: number[]) => $api(`/api/v1/helpdesk/tickets/${props.ticketId}/merge`, {
    method: 'POST', body: { source_ids: sourceIds }, schema: HelpdeskTicketSchema,
  }),
  onSuccess: async () => {
    selected.value = []
    search.value = ''
    await qc.invalidateQueries({ queryKey: helpdeskKeys.all })
    emit('merged')
  },
})
function toggle(row: HelpdeskTicketRow, value: boolean | 'indeterminate') {
  const on = value === true
  selected.value = on ? [...new Set([...selected.value, row.id])] : selected.value.filter(id => id !== row.id)
}
async function submit() {
  failure.value = null
  try {
    await merge.mutateAsync(selected.value)
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.merge.failed')
  }
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('helpdesk.merge.title')" data-testid="helpdesk-merge">
    <template #actions>
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-git-merge" :disabled="!hydrated || !selected.length" :loading="merge.isPending.value" :label="t('helpdesk.merge.submit', { count: selected.length })" data-testid="helpdesk-merge-submit" @click="submit" />
    </template>
    <p class="text-sm text-muted">{{ t('helpdesk.merge.hint') }}</p>
    <UInput v-model="search" class="mt-2 w-full" icon="i-lucide-search" :placeholder="t('helpdesk.merge.search')" :aria-label="t('helpdesk.merge.search')" data-testid="helpdesk-merge-search" />
    <ul v-if="rows.length" class="mt-2 flex max-h-56 flex-col divide-y divide-default overflow-y-auto rounded-control border border-default">
      <li v-for="row in rows" :key="row.id" class="flex items-center justify-between gap-3 px-3 py-2">
        <span class="min-w-0 truncate text-sm"><bdi dir="ltr">{{ row.number }}</bdi> · {{ row.subject }}</span>
        <UCheckbox :model-value="selected.includes(row.id)" :aria-label="row.number" :data-testid="`helpdesk-merge-${row.id}`" @update:model-value="value => toggle(row, value)" />
      </li>
    </ul>
    <p v-else-if="term" class="mt-2 text-sm text-muted">{{ t('app.noResults') }}</p>
    <p v-if="failure" class="mt-2 text-sm text-error" role="alert" data-testid="helpdesk-merge-error">{{ failure }}</p>
  </SharedRecordSection>
</template>
