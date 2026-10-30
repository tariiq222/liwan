<script setup lang="ts">
import EmptyState from '@webvue/ui/app/components/shared/feedback/EmptyState.vue'
import { avatarProps } from '@webvue/ui/app/utils/avatarTone'
import InboxComposer from '@/components/inbox/InboxComposer.vue'
import InboxContactPanel from '@/components/inbox/InboxContactPanel.vue'
import InboxOrderPanel from '@/components/inbox/InboxOrderPanel.vue'
import InboxConversationList from '@/components/inbox/InboxConversationList.vue'
import InboxThread from '@/components/inbox/InboxThread.vue'
import { ApiError } from '@/composables/useApi'
import { parseInboxListRoute, serializeInboxListRoute, type InboxListRoute } from '@/composables/inbox/inboxListRoute'
import { CONVERSATION_STATE_TONE, CSAT_TONE } from '@/composables/inbox/inboxPresentation'
import { replyWindowOpen } from '@/composables/inbox/inboxWindow'
import { useInboxCatalogEnabled, useInboxChannelCommerce } from '@/composables/inbox/useInboxCatalog'
import { useInboxConversation, useInboxConversations, useMarkInboxConversationRead } from '@/composables/inbox/useInbox'

// The inbox screen on SharedConversationLayout. From 768px the list is the shell's context-sidebar panel
// (InboxSidebarPanel); below it the list, the thread and the contact panel replace one another. The contact panel is
// the URL /inbox/<id>/info, so a direct link, a refresh and Back all work and the list filters stay in the query.
const props = defineProps<{ conversationId?: number; infoOpen?: boolean; ordersOpen?: boolean }>()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const routeState = computed(() => parseInboxListRoute(route.query))
const listQuery = computed(() => serializeInboxListRoute(routeState.value))
const { data, error, refetch } = useInboxConversation(() => props.conversationId)
const { data: conversations } = useInboxConversations(() => routeState.value)
const { mutate: markRead } = useMarkInboxConversationRead()
watch(() => data.value, conversation => { if (conversation?.unread) markRead(conversation.id) }, { immediate: true })
const hasConversations = computed(() => (conversations.value?.total ?? 0) > 0 || !!routeState.value.q || routeState.value.assignee !== 'all' || !!routeState.value.state || !!routeState.value.departmentId || !!routeState.value.csat)
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
const status = computed(() => error.value instanceof ApiError ? error.value.status : undefined)
// Escape leaves the open contact panel for the thread, as it leaves a record page for its list.
useEscapeBack(() => (panelOpen.value ? threadTo.value : undefined))

function updateRoute(next: InboxListRoute, options?: { replace: boolean }) {
  // A scope, state or page change is a step Back returns to; only a correction of the URL replaces its entry.
  void router[options?.replace ? 'replace' : 'push']({ path: route.path, query: serializeInboxListRoute(next) })
}
</script>

<template>
  <SharedConversationLayout :has-selection="hasSelection" :info-open="panelOpen">
    <template #list>
      <InboxConversationList page-heading :route-state="routeState" @update:route-state="updateRoute" />
    </template>

    <template #header>
      <header class="flex flex-wrap items-center gap-2 border-b border-default bg-default px-3 py-2">
        <UTooltip :text="t('app.back')">
          <UButton color="neutral" variant="ghost" square class="md:hidden" :to="{ path: '/inbox', query: listQuery }" :aria-label="t('app.back')">
            <UIcon name="i-lucide-arrow-left" class="size-5 rtl:rotate-180" aria-hidden="true" />
          </UButton>
        </UTooltip>
        <UAvatar v-bind="avatarProps(data?.contact.name, data?.contact.id)" size="lg" class="shrink-0" />
        <div class="min-w-0 flex-1 text-start">
          <h1 class="truncate text-lg font-semibold text-highlighted">{{ data?.contact.name || t('inbox.title') }}</h1>
          <p class="truncate text-xs text-muted"><bdi dir="ltr">{{ data?.contact.phone ?? '' }}</bdi></p>
        </div>
        <SharedStatusBadge v-if="data?.csat" :tone="CSAT_TONE[data.csat.score]" icon="i-lucide-star" :label="t('inbox.csat.badge', { score: t(`inbox.csat.${data.csat.score}`) })" data-testid="inbox-csat-badge" />
        <SharedStatusBadge v-if="data" :tone="CONVERSATION_STATE_TONE[data.state]" :label="t(`inbox.states.${data.state}`)" />
        <UTooltip v-if="catalogOn" :text="t('inbox.orders.title')">
          <UButton color="neutral" :variant="ordersOpen ? 'soft' : 'ghost'" square :to="ordersOpen ? threadTo : ordersTo" :aria-pressed="ordersOpen" :aria-label="t('inbox.orders.title')" data-testid="inbox-orders-toggle">
            <UIcon name="i-lucide-shopping-cart" class="size-5" aria-hidden="true" />
          </UButton>
        </UTooltip>
        <UTooltip :text="t('inbox.panel.title')">
          <UButton
            color="neutral"
            :variant="infoOpen ? 'soft' : 'ghost'"
            square
            :to="infoOpen ? threadTo : infoTo"
            :aria-pressed="infoOpen"
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
          <InboxThread :conversation-id="props.conversationId" :channel-id="data?.channel.id" :can-reply="data?.can_reply ?? false" :window-open="!!data && replyWindowOpen(data)" @reply="replyTo = $event" />
        </template>
        <template v-else>
          <!-- The one page heading when no thread header is shown. -->
          <h1 class="sr-only">{{ t('inbox.title') }}</h1>
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

    <template #info="{ headingLevel }">
      <header class="flex flex-wrap items-center gap-2 border-b border-default bg-default px-3 py-2">
        <UTooltip :text="t('app.back')">
          <UButton color="neutral" variant="ghost" square :to="threadTo" :aria-label="t('app.back')">
            <UIcon name="i-lucide-x" class="size-5" aria-hidden="true" />
          </UButton>
        </UTooltip>
        <component :is="headingLevel" class="min-w-0 flex-1 truncate text-base font-semibold text-highlighted">{{ ordersOpen ? t('inbox.orders.title') : t('inbox.panel.title') }}</component>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <InboxOrderPanel v-if="data && ordersOpen" :conversation-id="data.id" :window-open="replyWindowOpen(data)" />
        <InboxContactPanel v-else-if="data" :conversation="data" />
      </div>
    </template>

    <template #empty>
      <div class="grid w-full max-w-md place-items-center">
        <!-- The one page heading when no thread is open. -->
        <h1 class="sr-only">{{ t('inbox.title') }}</h1>
        <EmptyState
          class="w-full"
          :title="hasConversations ? t('inbox.select') : t('inbox.list.empty')"
          :description="hasConversations ? t('inbox.selectDescription') : t('inbox.list.emptyDescription')"
        >
          <template #icon>
            <UIcon name="i-lucide-inbox" class="size-8" />
          </template>
        </EmptyState>
      </div>
    </template>
  </SharedConversationLayout>
</template>
