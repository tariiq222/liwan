import { expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useBoardPagination } from '../useBoardPagination'

it('stops automatically fetching after a later page fails and resumes after explicit recovery', async () => {
  const scope = effectScope()
  const loading = ref(false), fetching = ref(false), error = ref<unknown>(null), more = ref(true), count = ref(50)
  let calls = 0
  const fetch = async () => { calls++; if (calls >= 6) { more.value = false; return }; fetching.value = true; await nextTick(); error.value = new Error('429'); fetching.value = false }
  scope.run(() => useBoardPagination({ loading, fetching, error, more, count, cap: 200, fetch }))
  await nextTick(); await nextTick(); await nextTick()
  expect(calls).toBe(1)
  error.value = null
  await nextTick(); await nextTick(); await nextTick()
  expect(calls).toBe(2)
  scope.stop()
})
