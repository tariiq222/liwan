<script setup lang="ts">
import { helpdeskOpportunityErrorMessage, useHelpdeskOpportunityAccess, useHelpdeskOpportunityPick, useLinkTicketOpportunity, useTicketOpportunity, useUnlinkTicketOpportunity } from '@/composables/useHelpdeskOpportunity'

// The CRM opportunity a ticket is linked to. Both applications' read rights show it; the ticket's write right changes it.
const props = defineProps<{ ticketId: number }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const access = useHelpdeskOpportunityAccess()
const current = useTicketOpportunity(() => props.ticketId, access.read)
const link = useLinkTicketOpportunity()
const unlink = useUnlinkTicketOpportunity()
const STATUS_TONE = { pending: 'info', won: 'success', lost: 'destructive' } as const
const refused = computed(() => (current.error.value as { status?: number } | null)?.status === 403)
const visible = computed(() => access.read.value && !refused.value && current.isSuccess.value)
const opportunity = computed(() => current.data.value?.opportunity ?? null)
const hidden = computed(() => current.data.value?.hidden === true)

const picking = ref(false)
const search = ref('')
const chosen = ref<number | null>(null)
const failure = ref('')
const pick = useHelpdeskOpportunityPick(search, picking)
const items = computed(() => pick.data.value?.items ?? [])
const locked = computed(() => !hydrated.value || link.isPending.value || unlink.isPending.value)

function close() {
  picking.value = false
  search.value = ''
  chosen.value = null
}

async function run(work: () => Promise<unknown>, done: string) {
  failure.value = ''
  try {
    await work()
    close()
    toast.add({ title: done, color: 'success' })
  } catch (error) {
    failure.value = helpdeskOpportunityErrorMessage(error, t)
  }
}

const confirm = () => chosen.value ? run(() => link.mutateAsync({ ticketId: props.ticketId, opportunityId: chosen.value! }), t('helpdesk.opportunity.linked')) : undefined
const remove = () => run(() => unlink.mutateAsync({ ticketId: props.ticketId }), t('helpdesk.opportunity.unlinked'))
const stageOf = (item: { stage: { name: string } | null }) => item.stage?.name ?? t('helpdesk.opportunity.noStage')
</script>

<template>
  <SharedRecordSection v-if="visible" variant="panel" :title="t('helpdesk.opportunity.title')" data-testid="helpdesk-opportunity">
    <div class="grid gap-3 text-sm">
      <div v-if="opportunity" class="grid gap-1" data-testid="helpdesk-opportunity-linked">
        <NuxtLink :to="`/crm/opportunities/${opportunity.id}`" class="min-w-0 truncate font-semibold text-primary hover:underline">{{ opportunity.contact_name }}</NuxtLink>
        <p class="flex flex-wrap items-center gap-2 text-muted">
          <span>{{ opportunity.stage?.name ?? t('helpdesk.opportunity.noStage') }}</span>
          <SharedStatusBadge :tone="STATUS_TONE[opportunity.status]" :label="t(`helpdesk.opportunity.status.${opportunity.status}`)" size="sm" />
          <SharedStatusBadge v-if="!opportunity.active" tone="neutral" :label="t('helpdesk.opportunity.archived')" size="sm" data-testid="helpdesk-opportunity-archived" />
        </p>
      </div>
      <p v-else-if="hidden" class="text-muted" data-testid="helpdesk-opportunity-hidden">{{ t('helpdesk.opportunity.hidden') }}</p>
      <p v-else class="text-muted" data-testid="helpdesk-opportunity-none">{{ t('helpdesk.opportunity.none') }}</p>
      <div v-if="access.write.value && !picking" class="flex flex-wrap gap-2">
        <UButton size="xs" :color="opportunity || hidden ? 'neutral' : 'primary'" variant="outline" :icon="opportunity || hidden ? 'i-lucide-replace' : 'i-lucide-link'" :label="opportunity || hidden ? t('helpdesk.opportunity.change') : t('helpdesk.opportunity.link')" :disabled="locked" data-testid="helpdesk-opportunity-link" @click="picking = true" />
        <UButton v-if="opportunity || hidden" size="xs" color="neutral" variant="outline" icon="i-lucide-unlink" :label="t('helpdesk.opportunity.unlink')" :loading="unlink.isPending.value" :disabled="locked" data-testid="helpdesk-opportunity-unlink" @click="remove" />
      </div>
      <div v-if="access.write.value && picking" class="grid gap-3" data-testid="helpdesk-opportunity-picker">
        <SharedPickList
          v-model="chosen"
          :items="items"
          :loading="pick.isFetching.value && !items.length"
          :error="pick.error.value"
          :disabled="locked"
          test-id="helpdesk-opportunity-pick"
          :search-label="t('helpdesk.opportunity.search')"
          :list-label="t('helpdesk.opportunity.listLabel')"
          :empty-text="t('helpdesk.opportunity.empty')"
          @update:search="search = $event"
          @retry="pick.refetch()"
        >
          <template #row="{ item }">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-highlighted">{{ item.contact_name }}</span>
              <span class="block truncate text-xs text-muted"><bdi dir="ltr">{{ item.phone }}</bdi> · {{ stageOf(item) }}</span>
            </span>
          </template>
        </SharedPickList>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" size="sm" :label="t('app.cancel')" :disabled="locked" data-testid="helpdesk-opportunity-cancel" @click="close" />
          <UButton size="sm" :label="t('helpdesk.opportunity.confirm')" :loading="link.isPending.value" :disabled="locked || !chosen" data-testid="helpdesk-opportunity-confirm" @click="confirm" />
        </div>
      </div>
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :description="failure" data-testid="helpdesk-opportunity-error" />
    </div>
  </SharedRecordSection>
</template>
