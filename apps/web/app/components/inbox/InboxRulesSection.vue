<script setup lang="ts">
import type { InboxRule } from '@webvue/contracts'
import { moveRuleId, ruleActionKeys } from '@/composables/inbox/inboxAutomation'
import { useDeleteInboxRule, useInboxRules, useReorderInboxRules, useSaveInboxRule } from '@/composables/inbox/useInboxAutomation'

// The rules in the order they are tried: the first match applies, and a rule with "stop" ends the search. A row opens
// the rule's page; the order is changed with the arrows (the server keeps it), a rule is switched off without deleting
// it, and a delete is confirmed inline.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { data, isLoading, error, refetch } = useInboxRules()
const { mutate: reorder, isPending: reordering } = useReorderInboxRules()
const { mutate: patch, isPending: patching } = useSaveInboxRule()
const { mutate: remove, isPending: removing } = useDeleteInboxRule()
const items = computed(() => data.value?.items ?? [])
const locked = computed(() => !hydrated.value || reordering.value || patching.value || removing.value)
const deleting = ref<InboxRule | null>(null)
const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })

function move(rule: InboxRule, step: -1 | 1) {
  const ids = moveRuleId(items.value.map(item => item.id), rule.id, step)
  reorder(ids, { onError: fail })
}
function toggle(rule: InboxRule, active: boolean) {
  patch({ id: rule.id, body: { active } }, { onError: fail })
}
function confirmDelete() {
  if (!deleting.value) return
  remove(deleting.value.id, { onSuccess: () => { deleting.value = null }, onError: fail })
}
const summary = (rule: InboxRule) => [
  t(`inbox.automation.rules.match.${rule.match_kind}`) + (rule.keywords.length ? `: ${rule.keywords.join('، ')}` : rule.option_id ? `: ${rule.option_id}` : ''),
  rule.channel?.name ?? t('inbox.automation.rules.anyChannel'),
  ...(rule.hours !== 'any' ? [t(`inbox.automation.rules.hours.${rule.hours}`)] : []),
].join(' · ')
</script>

<template>
  <SharedRecordSection variant="list" :title="t('inbox.automation.rules.title')" :description="t('inbox.automation.rules.hint')">
    <template #actions>
      <UButton to="/settings/apps/inbox/rules/new" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.automation.rules.add')" data-testid="inbox-rule-add" />
    </template>
    <SharedLoadingSkeleton v-if="isLoading" class="m-4" />
    <SharedPageState v-else-if="error" class="m-4" :error="error" @retry="refetch()" />
    <p v-else-if="!items.length" class="px-(--webvue-card-pad) py-4 text-sm text-muted" data-testid="inbox-rules-empty">{{ t('inbox.automation.rules.empty') }}</p>
    <ol v-else class="divide-y divide-default" :aria-label="t('inbox.automation.rules.title')">
      <li v-for="(rule, index) in items" :key="rule.id" class="flex flex-wrap items-center gap-3 px-(--webvue-card-pad) py-3" :data-testid="`inbox-rule-${rule.id}`">
        <span class="flex w-6 shrink-0 justify-center text-xs text-muted" aria-hidden="true">{{ index + 1 }}</span>
        <NuxtLink :to="`/settings/apps/inbox/rules/${rule.id}`" class="min-w-0 flex-1 text-start focus-visible:outline-2 focus-visible:outline-primary">
          <span class="block truncate text-sm font-medium text-highlighted" :class="{ 'text-muted': !rule.active }">{{ rule.name }}</span>
          <span class="block truncate text-xs text-muted">{{ summary(rule) }}</span>
          <span class="mt-1 flex flex-wrap gap-1">
            <SharedStatusBadge v-for="key in ruleActionKeys(rule)" :key="key" size="sm" tone="neutral" :label="t(`inbox.automation.rules.actions.${key}`)" />
            <SharedStatusBadge v-if="!rule.stop" size="sm" tone="info" :label="t('inbox.automation.rules.continues')" />
          </span>
        </NuxtLink>
        <div class="flex items-center gap-1">
          <USwitch :model-value="rule.active" :aria-label="t('inbox.automation.rules.toggle', { name: rule.name })" :disabled="locked" @update:model-value="toggle(rule, $event)" />
          <UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-arrow-up" :disabled="locked || index === 0" :aria-label="t('inbox.automation.rules.moveUp', { name: rule.name })" :data-testid="`inbox-rule-up-${rule.id}`" @click="move(rule, -1)" />
          <UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-arrow-down" :disabled="locked || index === items.length - 1" :aria-label="t('inbox.automation.rules.moveDown', { name: rule.name })" :data-testid="`inbox-rule-down-${rule.id}`" @click="move(rule, 1)" />
          <UButton type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :disabled="locked" :aria-label="t('inbox.settings.remove', { name: rule.name })" :data-testid="`inbox-rule-delete-${rule.id}`" @click="deleting = rule" />
        </div>
        <SharedInlineConfirm
          v-if="deleting?.id === rule.id"
          class="w-full"
          :title="t('inbox.automation.rules.deleteTitle', { name: rule.name })"
          :description="t('inbox.automation.rules.deleteDescription')"
          :confirm-label="t('inbox.settings.delete')"
          :pending="removing"
          @confirm="confirmDelete"
          @cancel="deleting = null"
        />
      </li>
    </ol>
  </SharedRecordSection>
</template>
