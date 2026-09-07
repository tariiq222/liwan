<template>
  <div class="space-y-2">
    <div data-slot="filter-row" class="flex flex-wrap items-center gap-2">
      <div data-slot="search" class="basis-full min-w-0 sm:basis-auto sm:min-w-48 sm:flex-1">
        <slot name="search" />
      </div>
      <div data-slot="controls" class="contents">
        <slot />
      </div>
      <div data-slot="view" class="contents">
        <slot name="view" />
      </div>
    </div>
    <div v-if="$slots.active" data-slot="active-row" class="flex flex-wrap items-center gap-2">
      <slot name="active" />
    </div>
  </div>
</template>
