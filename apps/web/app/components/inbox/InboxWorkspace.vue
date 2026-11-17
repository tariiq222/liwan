<script setup lang="ts">
import EmptyState from '@liwan/ui/app/components/shared/feedback/EmptyState.vue'
import { avatarProps } from '@liwan/ui/app/utils/avatarTone'
import InboxComposer from '@/components/inbox/InboxComposer.vue'
import InboxConversationActions from '@/components/inbox/InboxConversationActions.vue'
import InboxContactPanel from '@/components/inbox/InboxContactPanel.vue'
import InboxOrderPanel from '@/components/inbox/InboxOrderPanel.vue'
import InboxConversationList from '@/components/inbox/InboxConversationList.vue'
import InboxThread from '@/components/inbox/InboxThread.vue'
import { ApiError } from '@/composables/useApi'
import { parseInboxListRoute, serializeInboxListRoute, type InboxListRoute } from '@/composables/inbox/inboxListRoute'
import { CHANNEL_KIND_ICON } from '@/composables/inbox/inboxChannelKind'
import { CONVERSATION_STATE_TONE, CSAT_TONE, INBOX_PRIORITY_TONE } from '@/composables/inbox/inboxPresentation'
import { inboxContactName } from '@/composables/inbox/inboxContactName'
import { replyWindowOpen } from '@/composables/inbox/inboxWindow'
import { useInboxCatalogEnabled, useInboxChannelCommerce } from '@/composables/inbox/useInboxCatalog'
import { useInboxConversation, useInboxConversations, useMarkInboxConversationRead } from '@/composables/inbox/useInbox'

// The inbox page: the page header, then one 24px frame with the conversation list on the inline-start (360px) and the
// thread beside it. Below 768px the list, the thread and the contact panel replace one another; an open contact panel
// sits beside the thread from 1280px and replaces it below that. The contact panel is the URL /inbox/<id>/info, so a
// direct link, a refresh and Back all work and the list filters stay in the query.
const props = defineProps<{ conversationId?: number; infoOpen?: boolean; ordersOpen?: boolean }>()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { can } = useAccess()
const routeState = computed(() => parseInboxListRoute(route.query))
const listQuery = computed(() => serializeInboxListRoute(routeState.value))
const { data, error, refetch } = useInboxConversation(() => props.conversationId)
const contactName = computed(() => (data.value ? inboxContactName(data.value.contact, t) : ''))
const { data: conversations } = useInboxConversations(() => routeState.value)
const { mutate: markRead } = useMarkInboxConversationRead()
watch(() => data.value, conversation => { if (conversation?.unread) markRead(conversation.id) }, { immediate: true })
const hasConversations = computed(() => (conversations.value?.total ?? 0) > 0 || !!routeState.value.q || routeState.value.assignee !== 'all' || !!routeState.value.state || !!routeState.value.priority || !!routeState.value.channel || !!routeState.value.departmentId || !!routeState.value.csat)
const hasSelection = computed(() => !!props.conversationId)
const infoOpen = computed(() => !!props.infoOpen && hasSelection.value)
// Products and orders exist only with the catalog feature: the channel's commerce answer says whether it has a catalog.
const catalogOn = useInboxCatalogEnabled()
const ordersOpen = computed(() => !!props.ordersOpen && hasSelection.value && catalogOn.value)
const panelOpen = computed(() => infoOpen.value || ordersOpen.value)
const commerce = useInboxChannelCommerce(() => data.value?.channel.id, () => catalogOn.value && !!data.value?.can_reply)
const commerceReady = computed(() => !!commerce.data.value?.catalog)
const threadTo = computed(() => ({ path: `/inbox/${props.conversationId}`, query: listQuery.value }))
const infoTo = computed(() => ({ path: `/inbox/${props.conversationId}/info`, query: listQuery.value }))
const ordersTo = computed(() => ({ path: `/inbox/${props.conversationId}/orders`, query: listQuery.value }))
// The message the agent is answering; each conversation starts without one (the composer restores a stored draft's).
const replyTo = ref<{ id: number; preview: string } | null>(null)
watch(() => props.conversationId, () => { replyTo.value = null })
const canConnectChannel = computed(() => !hasConversations.value && can('inbox.channels.manage'))
const canShowUnassigned = computed(() => hasConversations.value && routeState.value.assignee !== 'unassigned')
const status = computed(() => error.value instanceof ApiError ? error.value.status : undefined)
// Escape leaves the open contact panel for the thread, as it leaves a record page for its list.
useEscapeBack(() => (panelOpen.value ? threadTo.value : undefined))

function updateRoute(next: InboxListRoute, options?: { replace: boolean }) {
  // A scope, state or page change is a step Back returns to; only a correction of the URL replaces its entry.
  void router[options?.replace ? 'replace' : 'push']({ path: route.path, query: serializeInboxListRoute(next) })
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('inbox.title')" :compact="hasSelection">
      <template v-if="can('inbox.channels.manage')" #actions>
        <UButton to="/settings/apps/inbox#channels" color="neutral" variant="soft" icon="i-lucide-settings" :label="t('inbox.settings.channels.title')" data-testid="inbox-channels-link" />
      </template>
    </SharedPageHeader>
    <SharedConversationLayout :class="{ 'liwan-conversation-fill--open': hasSelection }" :has-selection="hasSelection" :info-open="panelOpen">
      <template #list>
        <InboxConversationList class="min-h-0 flex-1" :route-state="routeState" :selected-id="props.conversationId" @update:route-state="updateRoute" />
      </template>
      <template #header>
        <header class="flex items-center gap-1 border-b-[1.5px] border-default bg-default px-3 py-3 md:gap-2 md:px-[18px]">
          <UTooltip :text="t('app.back')">
            <UButton color="neutral" variant="ghost" square class="md:hidden" :to="{ path: '/inbox', query: listQuery }" :aria-label="t('app.back')">
              <UIcon name="i-lucide-arrow-left" class="size-5 rtl:rotate-180" aria-hidden="true" />
            </UButton>
          </UTooltip>
          <UAvatar v-bind="avatarProps(contactName, data?.contact.id)" class="size-10 shrink-0 max-md:hidden" />
          <!-- Phones: the name, then the channel line beside the badges, in one grid; from 768px the wrappers dissolve and the
               name block and the badges are separate header items. -->
          <div class="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 md:contents">
            <div class="contents min-w-0 text-start md:block md:flex-1">
              <h2 class="col-span-2 truncate text-start text-(length:--liwan-fs-conversation-title)/[1.3] font-semibold text-highlighted">{{ contactName || t('inbox.title') }}</h2>
              <p v-if="data" class="flex min-w-0 items-center gap-1 text-start text-xs text-muted">
                <UIcon :name="CHANNEL_KIND_ICON[data.channel.kind]" class="size-3.5 shrink-0" :class="{ 'text-(color:--liwan-whatsapp)': data.channel.kind === 'whatsapp' }" aria-hidden="true" />
                <span class="truncate">{{ data.channel.name }}</span>
                <template v-if="data.contact.phone">· <bdi dir="ltr" class="truncate">{{ data.contact.phone }}</bdi></template>
              </p>
            </div>
            <div class="flex min-w-0 max-w-40 items-center gap-1 overflow-hidden md:contents">
              <SharedStatusBadge v-if="data?.csat" :tone="CSAT_TONE[data.csat.score]" icon="i-lucide-star" :label="t('inbox.csat.badge', { score: t(`inbox.csat.${data.csat.score}`) })" data-testid="inbox-csat-badge" />
              <UTooltip v-if="data?.referral_source" :text="data.referral_ref ? t('inbox.referral.ref', { ref: data.referral_ref }) : t('inbox.referral.badge', { source: t(`inbox.referral.${data.referral_source}`) })">
                <SharedStatusBadge tone="info" icon="i-lucide-megaphone" :label="t('inbox.referral.badge', { source: t(`inbox.referral.${data.referral_source}`) })" data-testid="inbox-referral-badge" />
              </UTooltip>
              <SharedStatusBadge v-if="data" :tone="CONVERSATION_STATE_TONE[data.state]" :label="t(`inbox.states.${data.state}`)" />
              <SharedStatusBadge v-if="data && INBOX_PRIORITY_TONE[data.priority]" :tone="INBOX_PRIORITY_TONE[data.priority]!" :label="t(`inbox.priorities.${data.priority}`)" data-testid="inbox-thread-priority-badge" />
            </div>
          </div>
          <InboxConversationActions v-if="data" :conversation="data" />
          <UTooltip v-if="catalogOn" :text="t('inbox.orders.title')">
            <UButton color="neutral" :variant="ordersOpen ? 'soft' : 'ghost'" square :to="ordersOpen ? threadTo : ordersTo" :aria-expanded="ordersOpen" :aria-label="t('inbox.orders.title')" data-testid="inbox-orders-toggle">
              <UIcon name="i-lucide-shopping-cart" class="size-5" aria-hidden="true" />
            </UButton>
          </UTooltip>
          <UTooltip :text="t('inbox.panel.title')">
            <UButton
              color="neutral"
              :variant="infoOpen ? 'soft' : 'ghost'"
              square
              :to="infoOpen ? threadTo : infoTo"
              :aria-expanded="infoOpen"
              :aria-label="t('inbox.panel.title')"
              data-testid="inbox-info-toggle"
            >
              <UIcon name="i-lucide-info" class="size-5" aria-hidden="true" />
            </UButton>
          </UTooltip>
        </header>
      </template>
      <template #thread>
        <div class="flex min-h-0 flex-1 flex-col" data-testid="inbox-thread">
          <template v-if="props.conversationId && !error">
            <InboxThread :conversation-id="props.conversationId" :channel-id="data?.channel.id" :channel-kind="data?.channel.kind" :can-reply="data?.can_reply ?? false" :window-open="!!data && replyWindowOpen(data)" @reply="replyTo = $event" />
          </template>
          <template v-else>
            <SharedForbiddenState v-if="status === 403" :description="t('inbox.unavailable')" />
            <SharedNotFoundState v-else-if="status === 404" class="m-4" :back-to="{ path: '/inbox', query: listQuery }" :back-label="t('inbox.title')" />
            <SharedErrorState v-else :error="error" class="m-4" @retry="refetch()" />
          </template>
        </div>
      </template>
      <template v-if="data" #composer>
        <InboxComposer v-if="data.can_reply" :key="data.id" v-model:reply-to="replyTo" :conversation="data" :commerce-ready="commerceReady" />
        <UAlert v-else class="m-2" color="neutral" variant="subtle" icon="i-lucide-eye" data-testid="inbox-read-only" :title="t('inbox.composer.readOnly')" :description="t('inbox.composer.readOnlyDescription')" />
      </template>
      <template #empty>
        <div class="grid w-full max-w-md place-items-center">
          <EmptyState
            icon="i-lucide-messages-square"
            class="w-full"
            :title="hasConversations ? t('inbox.select') : t('inbox.list.empty')"
            :description="hasConversations ? t('inbox.selectDescription') : t('inbox.list.emptyDescription')"
          >
            <template v-if="canShowUnassigned || canConnectChannel" #action>
              <UButton v-if="canShowUnassigned" color="neutral" variant="soft" icon="i-lucide-user-x" :label="t('inbox.showUnassigned')" data-testid="inbox-show-unassigned" @click="updateRoute({ ...routeState, assignee: 'unassigned', offset: 0 })" />
              <UButton v-else to="/settings/apps/inbox#channels" icon="i-lucide-plug" :label="t('inbox.connectChannel')" data-testid="inbox-connect-channel" />
            </template>
          </EmptyState>
        </div>
      </template>
      <template #info>
        <header class="flex flex-wrap items-center gap-2 border-b-[1.5px] border-default bg-default px-[18px] py-3">
          <UTooltip :text="t('app.back')">
            <UButton color="neutral" variant="ghost" square :to="threadTo" :aria-label="t('app.back')">
              <UIcon name="i-lucide-x" class="size-5" aria-hidden="true" />
            </UButton>
          </UTooltip>
          <h2 class="min-w-0 flex-1 truncate text-base font-semibold text-highlighted">{{ ordersOpen ? t('inbox.orders.title') : t('inbox.panel.title') }}</h2>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <InboxOrderPanel v-if="data && ordersOpen" :conversation-id="data.id" :window-open="replyWindowOpen(data)" />
          <InboxContactPanel v-else-if="data" :conversation="data" />
        </div>
      </template>
    </SharedConversationLayout>
  </SharedPageContainer>
</template>
