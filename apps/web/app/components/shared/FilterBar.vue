<template>
  <div class="space-y-2">
    <div data-slot="filter-row" class="flex flex-wrap items-center gap-2">
      <div data-slot="search" class="min-w-0 basis-full sm:basis-auto sm:min-w-48 sm:max-w-sm">
        <slot name="search" />
      </div>
      <div data-slot="controls" class="flex min-w-0 flex-wrap items-center gap-2">
        <slot />
      </div>
      <div v-if="$slots.view" data-slot="view" class="ms-auto flex flex-wrap items-center gap-2">
        <slot name="view" />
      </div>
      <div v-if="$slots.actions" data-slot="filter-actions" class="flex shrink-0 flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <div v-if="$slots.active" data-slot="active-row" class="flex flex-wrap items-center gap-2">
      <slot name="active" />
    </div>
  </div>
</template>
