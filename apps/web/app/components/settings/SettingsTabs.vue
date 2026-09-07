<script setup lang="ts">
const { sections = [] } = defineProps<{ sections?: { id: string; label: string }[] }>()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const windowHash = ref('')
onMounted(() => {
  windowHash.value = window.location.hash
})
useEventListener(window, 'hashchange', () => {
  windowHash.value = window.location.hash
})
const activeId = computed(() => decodeURIComponent((route.hash || windowHash.value).replace(/^#/, '')))
function isCurrent(id: string, index: number) {
  return activeId.value ? activeId.value === id : index === 0
}
function go(id: string, event: Event) {
  event.preventDefault()
  const hash = `#${id}`
  windowHash.value = hash
  void router.replace({ path: route.path, query: { ...route.query }, hash })
}
</script>

<template>
  <nav v-if="sections.length" class="nasq-settings-nav" :aria-label="t('settings.toc.label')">
    <a
      v-for="(section, index) in sections"
      :key="section.id"
      :href="`#${section.id}`"
      :aria-current="isCurrent(section.id, index) ? 'location' : undefined"
      @click="go(section.id, $event)"
    >
      {{ section.label }}
    </a>
  </nav>
</template>
