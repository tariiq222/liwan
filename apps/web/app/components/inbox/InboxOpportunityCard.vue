<script setup lang="ts">
import { inboxOpportunityErrorMessage } from '@/composables/inbox/inboxOpportunityErrors'
import { useConversationOpportunity, useCreateConversationOpportunity, useInboxOpportunityAccess, useLinkConversationOpportunity, useOpportunityPick, useUnlinkConversationOpportunity } from '@/composables/useInboxOpportunity'

// Both applications' permissions apply to the opportunity shown on this conversation.
const props = defineProps<{ conversationId: number; contactPhone: string | null; canReply: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const access = useInboxOpportunityAccess()
const current = useConversationOpportunity(() => props.conversationId, access.read)
const create = useCreateConversationOpportunity()
const link = useLinkConversationOpportunity(() => props.conversationId)
const unlink = useUnlinkConversationOpportunity(() => props.conversationId)
const STATUS_TONE = { pending: 'info', won: 'success', lost: 'destructive' } as const
const refused = computed(() => (current.error.value as { status?: number } | null)?.status === 403)
const visible = computed(() => access.read.value && !refused.value && current.isSuccess.value)
const canWrite = computed(() => access.write.value && props.canReply)
// Creating follows CRM's own rule, which an assigner without crm.leads.work also meets in manual distribution.
const showCreate = computed(() => !!props.contactPhone && (canWrite.value || (props.canReply && access.create.value)))
const opportunity = computed(() => current.data.value?.opportunity ?? null)
// A link the caller cannot read: nothing of it is shown and nothing can be created or linked over it.
const hidden = computed(() => current.data.value?.hidden === true)

const picking = ref(false)
const search = ref('')
const chosen = ref<number | null>(null)
const failure = ref('')
// The contact's phone finds the opportunities of the same contact until the user types a search.
const term = computed(() => search.value.trim() || props.contactPhone || '')
const pick = useOpportunityPick(term, picking)
const items = computed(() => pick.data.value?.items ?? [])
const locked = computed(() => !hydrated.value || create.isPending.value || link.isPending.value || unlink.isPending.value)

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
    failure.value = inboxOpportunityErrorMessage(error, t)
  }
}

async function createFromContact() {
  failure.value = ''
  const conversationId = props.conversationId
  try {
    await create.mutateAsync(conversationId)
    if (conversationId === props.conversationId) toast.add({ title: t('inbox.opportunity.created'), color: 'success' })
  } catch (error) {
    if (conversationId !== props.conversationId) return
    const reason = (error as { details?: { reason?: string } } | null)?.details?.reason
    if (reason === 'duplicate_phone') picking.value = true
    failure.value = inboxOpportunityErrorMessage(error, t)
  }
}

const confirm = () => chosen.value ? run(() => link.mutateAsync(chosen.value!), t('inbox.opportunity.linked')) : undefined
const remove = () => run(() => unlink.mutateAsync(), t('inbox.opportunity.unlinked'))
const stageOf = (item: { stage: { name: string } | null }) => item.stage?.name ?? t('inbox.opportunity.noStage')
</script>

<template>
  <SharedRecordSection v-if="visible" variant="panel" :title="t('inbox.opportunity.title')" data-testid="inbox-opportunity">
    <template v-if="opportunity" #actions>
      <UButton :to="`/crm/opportunities/${opportunity.id}`" size="sm" color="neutral" variant="outline" icon="i-lucide-arrow-up-right" :ui="{ leadingIcon: 'rtl:-scale-x-100' }" :label="t('inbox.opportunity.open')" data-testid="inbox-opportunity-open" />
    </template>
    <div class="grid gap-3 text-sm">
      <template v-if="opportunity">
        <div class="grid gap-1" data-testid="inbox-opportunity-linked">
          <p class="min-w-0 truncate font-semibold text-highlighted">{{ opportunity.contact_name }}</p>
          <p class="flex flex-wrap items-center gap-2 text-muted">
            <span>{{ opportunity.stage?.name ?? t('inbox.opportunity.noStage') }}</span>
            <SharedStatusBadge :tone="STATUS_TONE[opportunity.status]" :label="t(`inbox.opportunity.status.${opportunity.status}`)" size="sm" />
            <SharedStatusBadge v-if="!opportunity.active" tone="neutral" :label="t('inbox.opportunity.archived')" size="sm" data-testid="inbox-opportunity-archived" />
          </p>
        </div>
        <UButton v-if="canWrite" class="justify-self-start" size="xs" color="neutral" variant="outline" icon="i-lucide-unlink" :label="t('inbox.opportunity.unlink')" :loading="unlink.isPending.value" :disabled="locked" data-testid="inbox-opportunity-unlink" @click="remove" />
      </template>
      <p v-else-if="hidden" class="text-muted" data-testid="inbox-opportunity-hidden">{{ t('inbox.opportunity.hidden') }}</p>
      <template v-else>
        <p class="text-muted" data-testid="inbox-opportunity-none">{{ t('inbox.opportunity.none') }}</p>
        <div v-if="(canWrite || showCreate) && !picking" class="flex flex-wrap gap-2">
          <UButton v-if="showCreate" size="xs" icon="i-lucide-plus" :label="t('inbox.opportunity.create')" :loading="create.isPending.value" :disabled="locked || !access.create.value" data-testid="inbox-opportunity-create" @click="createFromContact" />
          <UButton v-if="canWrite" size="xs" color="neutral" variant="outline" icon="i-lucide-link" :label="t('inbox.opportunity.link')" :disabled="locked" data-testid="inbox-opportunity-link" @click="picking = true" />
        </div>
        <p v-if="canWrite && props.contactPhone && access.createManualOnly.value" class="text-xs text-muted" data-testid="inbox-opportunity-create-reason">{{ t('inbox.opportunity.createManualOnly') }}</p>
        <div v-if="picking" class="grid gap-3" data-testid="inbox-opportunity-picker">
          <SharedPickList
            v-model="chosen"
            :items="items"
            :loading="pick.isFetching.value && !items.length"
            :error="pick.error.value"
            :disabled="locked"
            test-id="inbox-opportunity-pick"
            :search-label="t('inbox.opportunity.search')"
            :list-label="t('inbox.opportunity.listLabel')"
            :empty-text="props.contactPhone ? t('inbox.opportunity.emptyForContact') : t('inbox.opportunity.emptyNoPhone')"
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
            <UButton color="neutral" variant="outline" size="sm" :label="t('app.cancel')" :disabled="locked" @click="close" />
            <UButton size="sm" :label="t('inbox.opportunity.confirm')" :loading="link.isPending.value" :disabled="locked || !chosen" data-testid="inbox-opportunity-confirm" @click="confirm" />
          </div>
        </div>
      </template>
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :description="failure" data-testid="inbox-opportunity-error" />
    </div>
  </SharedRecordSection>
</template>
