import { watchEffect, type Ref } from 'vue'

export function useBoardPagination(options: {
  loading: Ref<boolean>; fetching: Ref<boolean>; error: Ref<unknown>; more: Ref<boolean>; count: Ref<number>; cap: number; fetch: () => Promise<unknown>
}) {
  watchEffect(() => {
    if (!options.error.value && !options.loading.value && options.more.value && !options.fetching.value && options.count.value < options.cap) void options.fetch()
  })
}
