import { beforeEach, describe, expect, it } from 'vitest'
import { computed, ref, watch } from 'vue'
import { ApiError } from '../useApi'

const globals = globalThis as typeof globalThis & { useI18n: () => unknown; computed: typeof computed; watch: typeof watch }

async function submitError(error: Error | null) {
  const { useMeetingSubmitError } = await import('../useMeetingSubmitError')
  return useMeetingSubmitError({
    error: ref(error),
    reset: () => {},
    edits: () => 0,
    fields: { start_datetime: 'start' },
  })
}

describe('useMeetingSubmitError', () => {
  beforeEach(() => {
    globals.useI18n = () => ({ t: (key: string) => key })
    globals.computed = computed
    globals.watch = watch
  })

  it('asks the user to reload when someone else changed the meeting', async () => {
    const result = await submitError(new ApiError(409, 'conflict', 'stale'))
    expect(result.submitError.value).toBe('meetingsUx.errors.conflict')
  })

  it('puts a 422 on the field the server named', async () => {
    const result = await submitError(new ApiError(422, 'invalid', 'bad start', 'start_datetime'))
    expect(result.fieldErrors.value).toEqual({ start: 'bad start' })
  })

  it('shows the server message of an unmapped 422 and the edit notice for 403', async () => {
    expect((await submitError(new ApiError(422, 'invalid', 'overlap'))).submitError.value).toBe('overlap')
    expect((await submitError(new ApiError(403, 'forbidden', 'no'))).submitError.value).toBe('meetingsUx.editForbidden')
  })
})
