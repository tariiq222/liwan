<script setup lang="ts">
import InboxProductPicker from '@/components/inbox/InboxProductPicker.vue'
import {
  COMMERCE_LIMITS, COMMERCE_TYPES, addDraftSection, commerceProblem, pickedIds, removeDraftSection, toggleDraftProduct, type CommerceDraft,
} from '@/composables/inbox/inboxCommerce'
import { useInboxPickItems, type PickSource } from '@/composables/inbox/useInboxCatalog'

// Builds the product message an agent, a rule or an automatic message sends from the catalog: one product, a list of up
// to 30 products in up to 10 titled sections, or the whole catalog (optionally led by one product's image). Every text
// shows Meta's limit as a live counter; the owner of the draft sends only what buildCommerceContent accepts.
const draft = defineModel<CommerceDraft>({ required: true })
const props = defineProps<{ source: PickSource | null }>()
const { t } = useI18n()
const hydrated = useHydrated()
const limits = COMMERCE_LIMITS
const q = ref('')
const activeSection = ref(0)
const items = useInboxPickItems(() => props.source, q)
// Names stay known after a search narrows the list, so a chosen product keeps its label.
const names = reactive(new Map<string, string>())
watch(() => items.data.value?.items, (list) => { for (const item of list ?? []) names.set(item.product_retailer_id, item.name) }, { immediate: true })

const typeItems = computed(() => COMMERCE_TYPES.map(value => ({ value, label: t(`inbox.catalog.picker.types.${value}`) })))
const isList = computed(() => draft.value.type === 'product_list')
const max = computed(() => (isList.value ? limits.products : 1))
const picked = computed(() => pickedIds(draft.value))
const problem = computed(() => commerceProblem(draft.value))
const counter = (value: string, cap: number) => `${value.length}/${cap}`
const nameOf = (id: string) => names.get(id) ?? id

function onToggle(id: string) {
  toggleDraftProduct(draft.value, id, activeSection.value)
}
function addSection() {
  if (addDraftSection(draft.value)) activeSection.value = draft.value.sections.length - 1
}
function removeSection(index: number) {
  removeDraftSection(draft.value, index)
  activeSection.value = Math.min(activeSection.value, draft.value.sections.length - 1)
}
</script>

<template>
  <SharedSubCard tone="tinted" class="flex flex-col gap-2" data-testid="inbox-commerce-editor">
    <SharedSegmentedControl v-model="draft.type" class="self-start" :items="typeItems" :label="t('inbox.catalog.picker.type')" />
    <UFormField v-if="isList" :label="t('inbox.catalog.picker.header')" :hint="counter(draft.header, limits.header)" required>
      <UInput v-model="draft.header" class="w-full" :maxlength="limits.header" :disabled="!hydrated" data-testid="inbox-commerce-header" />
    </UFormField>
    <UFormField :label="t('inbox.catalog.picker.body')" :hint="counter(draft.body, limits.body)" :required="draft.type !== 'product'">
      <UTextarea v-model="draft.body" class="w-full" :rows="2" autoresize :maxrows="6" :maxlength="limits.body" :disabled="!hydrated" data-testid="inbox-commerce-body" />
    </UFormField>
    <UFormField :label="t('inbox.catalog.picker.footer')" :hint="counter(draft.footer, limits.footer)">
      <UInput v-model="draft.footer" class="w-full" :maxlength="limits.footer" :disabled="!hydrated" />
    </UFormField>

    <template v-if="isList">
      <SharedSubCard v-for="(section, index) in draft.sections" :key="index" class="flex flex-col gap-2" :data-testid="`inbox-commerce-section-${index}`">
        <div class="flex items-end gap-2">
          <UFormField class="min-w-0 flex-1" :label="t('inbox.catalog.picker.sectionTitle')" :hint="counter(section.title, limits.sectionTitle)">
            <UInput v-model="section.title" class="w-full" :maxlength="limits.sectionTitle" :disabled="!hydrated" />
          </UFormField>
          <UButton type="button" color="neutral" :variant="activeSection === index ? 'soft' : 'outline'" icon="i-lucide-mouse-pointer-click" :aria-pressed="activeSection === index" :label="t('inbox.catalog.picker.fillSection')" @click="activeSection = index" />
          <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="t('inbox.catalog.picker.removeSection')" @click="removeSection(index)" />
        </div>
        <ul v-if="section.ids.length" class="flex flex-wrap gap-1.5" :aria-label="t('inbox.catalog.picker.sectionProducts')">
          <li v-for="id in section.ids" :key="id" class="inline-flex items-center gap-1 rounded-full bg-elevated py-0.5 ps-2.5 pe-1 text-xs ring ring-default">
            <span class="max-w-40 truncate">{{ nameOf(id) }}</span>
            <UButton type="button" color="neutral" variant="ghost" size="xs" square icon="i-lucide-x" :aria-label="t('inbox.catalog.picker.removeProduct', { name: nameOf(id) })" @click="onToggle(id)" />
          </li>
        </ul>
      </SharedSubCard>
      <UButton type="button" class="self-start" color="neutral" variant="outline" icon="i-lucide-list-plus" :label="t('inbox.catalog.picker.addSection')" :disabled="!hydrated || draft.sections.length >= limits.sections" @click="addSection" />
    </template>

    <p v-if="draft.type === 'catalog_message'" class="text-xs text-muted">{{ t('inbox.catalog.picker.thumbnailHint') }}</p>
    <p class="text-sm font-medium text-highlighted">{{ isList ? t('inbox.catalog.picker.pickFor', { section: draft.sections[activeSection]?.title || String(activeSection + 1) }) : draft.type === 'product' ? t('inbox.catalog.picker.pickOne') : t('inbox.catalog.picker.pickThumbnail') }}</p>
    <InboxProductPicker v-if="props.source" v-model:q="q" :items="items.data.value?.items ?? []" :picked="picked" :max="max" :loading="items.isPending.value" :error="items.error.value" @toggle="onToggle" @retry="items.refetch()" />
    <p v-else class="text-sm text-warning" data-testid="inbox-commerce-no-source">{{ t('inbox.catalog.picker.needsChannel') }}</p>
    <p v-if="problem" class="text-xs text-muted" data-testid="inbox-commerce-problem">{{ t(`inbox.catalog.picker.problems.${problem}`) }}</p>
  </SharedSubCard>
</template>
