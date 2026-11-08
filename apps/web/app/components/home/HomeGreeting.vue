<script setup lang="ts">
import { workCountLabel } from '@/composables/nav/attentionModel'
import { useMyWork } from '@/composables/useMyWork'
import HomeHello from '@/components/home/HomeHello.vue'

// «صباح الخير يا سارة» (evening after noon) with the date and, when the person's work has arrived, how many tasks and
// decisions wait today. The time and date are the browser's, so they are read after mount: the server and the browser
// draw the same first frame, which greets by name only. A count that is pending or failed is left out, never a zero.
const NOON = 12
const { t, locale } = useI18n()
const { me } = useMe()
const { available, grouped, pending, failed, cappedKinds } = useMyWork()
const now = ref<Date | null>(null)
onMounted(() => { now.value = new Date() })

const firstName = computed(() => me.value?.name?.trim().split(/\s+/)[0] ?? '')
const title = computed(() => {
  if (!firstName.value) return t('nav.home')
  if (!now.value) return t('home.greeting', { name: firstName.value })
  return t(now.value.getHours() < NOON ? 'home.greetingMorning' : 'home.greetingEvening', { name: firstName.value })
})
const date = computed(() => now.value?.toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) ?? '')

function countText(key: string, kind: 'execute' | 'decide'): string | null {
  const count = grouped.value[kind].length
  return count > 0 ? t(key, { n: workCountLabel(count, cappedKinds.value.includes(kind)) }, count) : null
}
const summary = computed(() => {
  if (!available.value || pending.value || failed.value) return ''
  const [first, second] = [countText('home.count.tasks', 'execute'), countText('home.count.decisions', 'decide')].filter((text): text is string => text !== null)
  if (first && second) return t('home.summary.two', { first, second })
  return first ? t('home.summary.one', { item: first }) : ''
})
const subtitle = computed(() => [date.value, summary.value].filter(Boolean).join(' · '))
</script>

<template>
  <HomeHello :title="title" data-testid="home-greeting">
    <template v-if="subtitle" #default>{{ subtitle }}</template>
  </HomeHello>
</template>
