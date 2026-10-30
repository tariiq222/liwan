<script setup lang="ts">
import { joinList } from '@/utils/listFormat'
import type { EffectiveCapability, PermissionDefinition } from '@liwan/contracts'
import { CAPABILITY_GROUPS_OPEN_LIMIT, groupCapabilities } from '@/components/access/capabilityGroups'
import { permissionDomainLabel } from '@/utils/labelFallback'

// A user's effective capabilities, grouped by domain with the roles that grant each one. A long list opens its groups
// collapsed; a short one opens them all.
const props = defineProps<{ capabilities: EffectiveCapability[]; permissions?: PermissionDefinition[] }>()
const { t, te, locale } = useI18n()
const lang = computed(() => locale.value === 'ar' ? 'ar' : 'en')
const definitions = computed(() => new Map((props.permissions ?? []).map((permission) => [permission.key, permission])))
const capabilityLabel = (key: string) => definitions.value.get(key)?.label[lang.value] ?? definitions.value.get(key)?.label.ar ?? t('access.roles.unknownPermission')
const sourcesOf = (capability: EffectiveCapability) => joinList(capability.sources.map((source) => source.role.name[lang.value] ?? source.role.name.ar), t)
const groups = computed(() => groupCapabilities(props.capabilities, (key) => definitions.value.get(key)?.domain ?? key.split('.')[0]!))
const collapsedByDefault = computed(() => props.capabilities.length > CAPABILITY_GROUPS_OPEN_LIMIT)
const toggled = ref(new Set<string>())
const isOpen = (domain: string) => collapsedByDefault.value === toggled.value.has(domain)
function toggle(domain: string) {
  const next = new Set(toggled.value)
  if (!next.delete(domain)) next.add(domain)
  toggled.value = next
}
const listId = (domain: string) => `capability-group-${domain}`
</script>

<template>
  <div class="grid gap-3">
    <SharedSubCard v-for="group in groups" :key="group.domain" tone="tinted">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 rounded-control text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :aria-expanded="isOpen(group.domain)"
        :aria-controls="listId(group.domain)"
        @click="toggle(group.domain)"
      >
        <span class="text-sm font-semibold text-highlighted">{{ permissionDomainLabel(group.domain, t, te) }}</span>
        <span class="flex items-center gap-2">
          <SharedStatusBadge tone="neutral" size="sm" :label="String(group.items.length)" />
          <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform motion-reduce:transition-none" :class="{ 'rotate-180': isOpen(group.domain) }" aria-hidden="true" />
        </span>
      </button>
      <ul v-show="isOpen(group.domain)" :id="listId(group.domain)" class="mt-3 grid gap-2 text-sm">
        <li v-for="capability in group.items" :key="capability.key">
          <span class="text-highlighted">{{ capabilityLabel(capability.key) }}</span>
          <span v-if="capability.sources.length" class="block text-xs text-muted">{{ sourcesOf(capability) }}</span>
        </li>
      </ul>
    </SharedSubCard>
  </div>
</template>
