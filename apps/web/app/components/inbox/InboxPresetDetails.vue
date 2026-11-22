<script setup lang="ts">
import type { InboxPresetKey } from '@liwan/contracts'
import { useInboxPresetPreview } from '@/composables/inbox/useInboxSettings'

// Read-only list of what applying a sector preset would add or set, from the server's single copy of the preset.
const props = defineProps<{ presetKey: InboxPresetKey }>()
const { t } = useI18n()
const { data, error, isPending, refetch } = useInboxPresetPreview(() => props.presetKey)
const sectionId = (name: string) => `preset-${props.presetKey}-${name}`
const tn = (key: string, named?: Record<string, unknown>) => t(`inbox.settings.presets.details.${key}`, named ?? {})
const status = (exists: boolean) => ({ tone: exists ? 'neutral' : 'success', label: tn(exists ? 'exists' : 'willAdd') } as const)
</script>

<template>
  <div :id="`inbox-preset-details-${presetKey}`" :data-testid="`inbox-preset-details-${presetKey}`">
    <SharedPageState v-if="error" :error="error" @retry="refetch()" />
    <SharedLoadingSkeleton v-else-if="isPending || !data" />
    <div v-else class="grid gap-4">
      <p v-if="data.applied" class="text-sm text-muted">{{ tn('appliedBefore') }}</p>

      <section class="grid gap-2" :aria-labelledby="sectionId('departments')">
        <h4 :id="sectionId('departments')" class="text-sm font-semibold text-highlighted">{{ tn('departments') }}</h4>
        <ul class="flex flex-wrap gap-2">
          <li v-for="item in data.departments" :key="item.name" class="flex items-center gap-2 text-sm">{{ item.name }}<SharedStatusBadge size="sm" v-bind="status(item.exists)" /></li>
        </ul>
      </section>

      <section class="grid gap-2" :aria-labelledby="sectionId('tags')">
        <h4 :id="sectionId('tags')" class="text-sm font-semibold text-highlighted">{{ tn('tags') }}</h4>
        <ul class="flex flex-wrap gap-2">
          <li v-for="item in data.tags" :key="item.name" class="flex items-center gap-2 text-sm">{{ item.name }}<SharedStatusBadge size="sm" v-bind="status(item.exists)" /></li>
        </ul>
      </section>

      <section class="grid gap-2" :aria-labelledby="sectionId('canned')">
        <h4 :id="sectionId('canned')" class="text-sm font-semibold text-highlighted">{{ tn('canned') }}</h4>
        <ul class="grid gap-2">
          <li v-for="item in data.canned_replies" :key="item.shortcut" class="grid gap-1 text-sm">
            <span class="flex flex-wrap items-center gap-2"><bdi dir="auto" class="font-medium">/{{ item.shortcut }}</bdi><SharedStatusBadge size="sm" v-bind="status(item.exists)" /></span>
            <span class="text-muted">{{ item.body }}</span>
          </li>
        </ul>
      </section>

      <section class="grid gap-2" :aria-labelledby="sectionId('welcome')">
        <h4 :id="sectionId('welcome')" class="text-sm font-semibold text-highlighted">{{ tn('welcome') }}</h4>
        <p class="text-xs text-muted">{{ tn('welcomeNote') }}</p>
        <p class="text-sm text-muted">{{ data.welcome.body }}</p>
        <ul class="flex flex-wrap gap-2">
          <li v-for="button in data.welcome.buttons" :key="button" class="rounded-control px-3 py-1 text-sm ring ring-default">{{ button }}</li>
        </ul>
      </section>

      <section class="grid gap-2" :aria-labelledby="sectionId('rules')">
        <h4 :id="sectionId('rules')" class="text-sm font-semibold text-highlighted">{{ tn('rules') }}</h4>
        <p class="text-xs text-muted">{{ tn('rulesNote') }}</p>
        <ul class="grid gap-2">
          <li v-for="rule in data.rules" :key="rule.name" class="grid gap-1 text-sm">
            <span class="flex flex-wrap items-center gap-2"><span class="font-medium">{{ rule.name }}</span><SharedStatusBadge size="sm" v-bind="status(rule.exists)" /></span>
            <span class="text-xs text-muted">
              {{ tn('ruleButton', { button: rule.button }) }}
              <template v-if="rule.department"> · {{ tn('ruleDepartment', { department: rule.department }) }}</template>
              <template v-if="rule.tags.length"> · {{ tn('ruleTags', { tags: joinList(rule.tags, t) }) }}</template>
            </span>
            <span class="text-muted">{{ rule.reply }}</span>
          </li>
        </ul>
      </section>

      <section class="grid gap-2" :aria-labelledby="sectionId('away')">
        <h4 :id="sectionId('away')" class="text-sm font-semibold text-highlighted">{{ tn('away') }}</h4>
        <p class="text-xs text-muted">{{ tn('awayNote') }}</p>
        <p class="text-sm text-muted">{{ data.away.body }}</p>
      </section>

      <section class="grid gap-2" :aria-labelledby="sectionId('campaigns')">
        <h4 :id="sectionId('campaigns')" class="text-sm font-semibold text-highlighted">{{ tn('campaigns') }}</h4>
        <dl class="grid gap-1 text-sm">
          <div><dt class="text-xs text-muted">{{ tn('stopKeywords') }}</dt><dd>{{ joinList(data.campaigns.stop_keywords, t) }}</dd></div>
          <div><dt class="text-xs text-muted">{{ tn('startKeywords') }}</dt><dd>{{ joinList(data.campaigns.start_keywords, t) }}</dd></div>
          <div><dt class="text-xs text-muted">{{ tn('stopReply') }}</dt><dd class="text-muted">{{ data.campaigns.stop_reply }}</dd></div>
          <div><dt class="text-xs text-muted">{{ tn('startReply') }}</dt><dd class="text-muted">{{ data.campaigns.start_reply }}</dd></div>
        </dl>
      </section>

      <section v-if="data.settings" class="grid gap-2" :aria-labelledby="sectionId('policy')">
        <h4 :id="sectionId('policy')" class="text-sm font-semibold text-highlighted">{{ tn('policy') }}</h4>
        <ul class="grid gap-1 text-sm">
          <li>{{ tn('policyVisibility', { value: t(`inbox.settings.policy.visibility.${data.settings.visibility_policy}`) }) }}</li>
          <li>{{ tn('policyRetention', { months: data.settings.retention_months }) }}</li>
        </ul>
      </section>
    </div>
  </div>
</template>
