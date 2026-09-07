<template>
  <div class="mx-auto w-full max-w-7xl space-y-8">
    <SharedPageHeader :title="$t('pages.reports')" />
    <section class="rounded-lg border border-dashed border-border/80 bg-card px-6 py-12 text-center text-sm text-muted-foreground">
      {{ $t('app.noResults') }}
    </section>
  </div>
</template>
