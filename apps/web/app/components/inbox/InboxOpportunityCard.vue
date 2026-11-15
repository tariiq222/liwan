<script setup lang="ts">
import { inboxOpportunityErrorMessage } from '@/composables/inbox/inboxOpportunityErrors'
import { useConversationOpportunity, useInboxOpportunityAccess, useLinkConversationOpportunity, useOpportunityPick, useUnlinkConversationOpportunity } from '@/composables/inbox/useInboxOpportunity'

// The CRM opportunity of a conversation (the inbox bridge to CRM): the linked one with its stage and status, linking to
// its page, or an action that links an EXISTING opportunity (nothing is created here). The picker first lists the
// opportunities of the contact's own phone and searches by name or phone as the user types. Shown only while the tenant
// has CRM and the user may read both applications; the link and unlink need the reply and the work capabilities.
const props = defineProps<{ conversationId: number; contactPhone: string | null; canReply: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const access = useInboxOpportunityAccess()
const current = useConversationOpportunity(() => props.conversationId, access.read)
const link = useLinkConversationOpportunity(() => props.conversationId)
const unlink = useUnlinkConversationOpportunity(() => props.conversationId)
const STATUS_TONE = { pending: 'info', won: 'success', lost: 'destructive' } as const
const refused = computed(() => (current.error.value as { status?: number } | null)?.status === 403)
const visible = computed(() => access.read.value && !refused.value && current.isSuccess.value)
const canWrite = computed(() => access.write.value && props.canReply)

const picking = ref(false)
const search = ref('')
const chosen = ref<number | null>(null)
const failure = ref('')
// The contact's phone finds the opportunities of the same contact until the user types a search.
const term = computed(() => search.value.trim() || props.contactPhone || '')
const pick = useOpportunityPick(term, picking)
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
    failure.value = inboxOpportunityErrorMessage(error, t)
  }
}

const confirm = () => chosen.value ? run(() => link.mutateAsync(chosen.value!), t('inbox.opportunity.linked')) : undefined
const remove = () => run(() => unlink.mutateAsync(), t('inbox.opportunity.unlinked'))
const stageOf = (item: { stage: { name: string } | null }) => item.stage?.name ?? t('inbox.opportunity.noStage')
</script>

<template>
  <SharedRecordSection v-if="visible" variant="panel" :title="t('inbox.opportunity.title')" data-testid="inbox-opportunity">
    <div class="grid gap-3 text-sm">
      <template v-if="current.data.value">
        <div class="grid gap-1" data-testid="inbox-opportunity-linked">
          <NuxtLink :to="`/crm/opportunities/${current.data.value.id}`" class="min-w-0 truncate font-semibold text-primary hover:underline">{{ current.data.value.contact_name }}</NuxtLink>
          <p class="flex flex-wrap items-center gap-2 text-muted">
            <span>{{ current.data.value.stage?.name ?? t('inbox.opportunity.noStage') }}</span>
            <SharedStatusBadge :tone="STATUS_TONE[current.data.value.status]" :label="t(`inbox.opportunity.status.${current.data.value.status}`)" size="sm" />
            <SharedStatusBadge v-if="!current.data.value.active" tone="neutral" :label="t('inbox.opportunity.archived')" size="sm" data-testid="inbox-opportunity-archived" />
          </p>
        </div>
        <UButton v-if="canWrite" class="justify-self-start" size="xs" color="neutral" variant="outline" icon="i-lucide-unlink" :label="t('inbox.opportunity.unlink')" :loading="unlink.isPending.value" :disabled="locked" data-testid="inbox-opportunity-unlink" @click="remove" />
      </template>
      <template v-else>
        <p class="text-muted" data-testid="inbox-opportunity-none">{{ t('inbox.opportunity.none') }}</p>
        <UButton v-if="canWrite && !picking" class="justify-self-start" size="xs" color="neutral" variant="outline" icon="i-lucide-link" :label="t('inbox.opportunity.link')" :disabled="!hydrated" data-testid="inbox-opportunity-link" @click="picking = true" />
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
