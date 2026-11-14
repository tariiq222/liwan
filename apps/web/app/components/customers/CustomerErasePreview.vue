<script setup lang="ts">
import type { CustomerErasePreview, CustomerPrivacyIncomplete, CustomerPrivacyItem } from '@liwan/contracts'
import { blockedByOwner, distinctReasons, groupPrivacyItems, knownPrivacyReason } from '@/composables/customers/customerPrivacyView'

// What an erase would do to one customer, in plain words: what is erased with counts, what the law keeps, what the
// erase cannot change, and, when something blocks it, exactly what and what to do. A key this build does not know is
// shown as the server named it. The data of other applications arrives as keys: labels here are this folder's own
// strings, so the customers folder imports no other application's component.
const props = defineProps<{ preview: CustomerErasePreview }>()
const { t, te, locale } = useI18n()
const groups = computed(() => groupPrivacyItems(props.preview.items))
const blockers = computed(() => props.preview.incomplete)
const minutes = computed(() => Math.max(1, Math.round(props.preview.expires_in / 60)))
const label = (key: string) => te(`customers.privacy.items.${key}`) ? t(`customers.privacy.items.${key}`) : key
const notCoveredLabel = (key: string) => te(`customers.privacy.notCoveredKeys.${key}`) ? t(`customers.privacy.notCoveredKeys.${key}`) : key
const keptWhy = (item: CustomerPrivacyItem) => te(`customers.privacy.keptWhy.${item.key}`) ? t(`customers.privacy.keptWhy.${item.key}`) : t('customers.privacy.erase.keptWhyFallback')
function reasonCopy(reason: string) {
  return knownPrivacyReason(reason) ?? 'unknown'
}
const ownerLabel = (owner: string) => te(`customers.privacy.owners.${owner}`) ? t(`customers.privacy.owners.${owner}`) : owner
const listed = (names: string[]) => new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(names)
/** One line per application that owns a blocked item of this reason: the application and what it holds. */
const blockedByApp = (reason: string) => blockedByOwner(blockers.value, reason).map(({ owner, keys }) => ({
  owner,
  text: t('customers.privacy.erase.blockedApp', { app: ownerLabel(owner), items: listed(keys.map(label)) }),
}))
</script>

<template>
  <div class="space-y-5" data-testid="customer-erase-preview">
    <UAlert v-if="blockers.length" color="error" variant="subtle" icon="i-lucide-octagon-alert" role="alert" :title="t('customers.privacy.erase.blocked')" data-testid="customer-erase-blocked">
      <template #description>
        <p>{{ t('customers.privacy.erase.blockedHint') }}</p>
        <ul class="mt-3 space-y-3">
          <li v-for="reason in distinctReasons(blockers)" :key="reason" :data-testid="`customer-erase-blocker-${reason}`">
            <p class="font-medium">{{ t(`customers.privacy.erase.reasons.${reasonCopy(reason)}.title`) }}</p>
            <p>{{ t(`customers.privacy.erase.reasons.${reasonCopy(reason)}.action`) }}</p>
            <ul class="mt-1 list-disc ps-5 text-sm opacity-80">
              <li v-for="line in blockedByApp(reason)" :key="line.owner" :data-testid="`customer-erase-blocked-app-${line.owner}`">{{ line.text }}</li>
            </ul>
          </li>
        </ul>
      </template>
    </UAlert>

    <section v-if="groups.erase.length" :aria-label="t('customers.privacy.erase.willErase')">
      <h3 class="font-medium">{{ t('customers.privacy.erase.willErase') }}</h3>
      <p class="text-sm text-muted">{{ t('customers.privacy.erase.willEraseHint') }}</p>
      <ul class="mt-2 divide-y divide-default rounded-lg border border-default">
        <li v-for="item in groups.erase" :key="item.key" class="flex items-center justify-between gap-3 px-3 py-2" :data-testid="`customer-erase-item-${item.key}`">
          <span>{{ label(item.key) }}</span>
          <span v-if="item.complete" class="tabular-nums">{{ item.count }}</span>
          <span v-else class="text-muted" :title="t('customers.privacy.erase.unavailableHint')" data-testid="customer-erase-count-unavailable">{{ t('customers.privacy.erase.unavailable') }}</span>
        </li>
      </ul>
    </section>

    <section v-if="groups.retain.length" :aria-label="t('customers.privacy.erase.willKeep')">
      <h3 class="font-medium">{{ t('customers.privacy.erase.willKeep') }}</h3>
      <p class="text-sm text-muted">{{ t('customers.privacy.erase.willKeepHint') }}</p>
      <ul class="mt-2 divide-y divide-default rounded-lg border border-default">
        <li v-for="item in groups.retain" :key="item.key" class="px-3 py-2" :data-testid="`customer-erase-item-${item.key}`">
          <div class="flex items-center justify-between gap-3">
            <span>{{ label(item.key) }}</span>
            <span v-if="item.complete" class="tabular-nums">{{ item.count }}</span>
            <span v-else class="text-muted" :title="t('customers.privacy.erase.unavailableHint')" data-testid="customer-erase-count-unavailable">{{ t('customers.privacy.erase.unavailable') }}</span>
          </div>
          <p class="text-sm text-muted">{{ keptWhy(item) }}</p>
        </li>
      </ul>
    </section>

    <section v-if="groups.unhandled.length" :aria-label="t('customers.privacy.erase.unhandled')">
      <h3 class="font-medium">{{ t('customers.privacy.erase.unhandled') }}</h3>
      <ul class="mt-2 divide-y divide-default rounded-lg border border-default">
        <li v-for="item in groups.unhandled" :key="item.key" class="flex items-center justify-between gap-3 px-3 py-2" :data-testid="`customer-erase-item-${item.key}`">
          <bdi dir="ltr">{{ label(item.key) }}</bdi>
          <span v-if="item.complete" class="tabular-nums">{{ item.count }}</span>
          <span v-else class="text-muted" :title="t('customers.privacy.erase.unavailableHint')" data-testid="customer-erase-count-unavailable">{{ t('customers.privacy.erase.unavailable') }}</span>
        </li>
      </ul>
    </section>

    <p v-if="!props.preview.items.length" class="text-sm text-muted">{{ t('customers.privacy.erase.nothing') }}</p>

    <section v-if="props.preview.not_covered.length" :aria-label="t('customers.privacy.erase.notCovered')">
      <h3 class="font-medium">{{ t('customers.privacy.erase.notCovered') }}</h3>
      <p class="text-sm text-muted">{{ t('customers.privacy.erase.notCoveredHint') }}</p>
      <ul class="mt-2 list-disc ps-5" data-testid="customer-erase-not-covered">
        <li v-for="key in props.preview.not_covered" :key="key">{{ notCoveredLabel(key) }}</li>
      </ul>
    </section>

    <p class="text-sm text-muted">{{ t('customers.privacy.erase.valid', { minutes }) }}</p>
  </div>
</template>
