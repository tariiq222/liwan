<script setup lang="ts">
/*
 * The error summary at the top of a form (DESIGN.md §6): shown after a submit attempt that found mistakes, it names
 * each one as a link; following a link moves focus to that field's first invalid control (or its first control).
 * `focus()` moves focus to the summary itself, which the page calls once after a refused submit so the reader hears the
 * list before the fields. Fields are found by the `name` given to `SharedFormField` / `SharedMoneyField` (`data-field`).
 * Nothing renders while `errors` is empty. All text arrives as props.
 */
import { focusFormField, type ErrorSummaryItem } from '../../../utils/formErrors'

const props = defineProps<{
  /** The heading, such as "Fix these before saving". */
  title: string
  errors: ErrorSummaryItem[]
}>()
const root = ref<HTMLElement | null>(null)
const headingId = `error-summary-${useId()}`
function follow(event: Event, field: string) {
  event.preventDefault()
  focusFormField(root.value?.closest('form') ?? document, field)
}
defineExpose({ focus: () => root.value?.focus() })
</script>

<template>
  <section
    v-if="props.errors?.length"
    ref="root"
    tabindex="-1"
    class="rounded-card border border-error/40 bg-error/10 p-4 text-sm text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error"
    :aria-labelledby="headingId"
    data-slot="error-summary"
  >
    <h2 :id="headingId" class="font-semibold text-highlighted">{{ props.title }}</h2>
    <ul class="mt-2 grid gap-1">
      <li v-for="item in props.errors" :key="item.field">
        <a :href="`#field-${item.field}`" class="text-error underline underline-offset-2" @click="follow($event, item.field)">{{ item.message }}</a>
      </li>
    </ul>
  </section>
</template>
