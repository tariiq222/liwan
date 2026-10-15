import * as recordNavigation from '../../utils/recordListOrigin'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, ref, watch } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { parsePositiveId } from '../../utils/routeParams'

const RECORD_PAGES = ['[id].vue', '[id]/edit.vue', '[id]/minutes.vue', '[id]/print.vue', 'series/[id].vue', 'series/[id]/edit.vue']

function sourceOf(file: string) {
  return readFileSync(resolve('app/pages/meetings', file), 'utf8')
}

/** Compile edit.vue's script with stubbed composables and report what it asked the meeting query for. */
function editPage(routeId: string) {
  const script = parse(sourceOf('[id]/edit.vue')).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const meeting = ref(null)
  const useMeeting = vi.fn(() => ({ data: meeting, error: ref(null) }))
  const scope = { ...recordNavigation, computed, ref, watch, nextTick, parsePositiveId, ApiError, useMeeting,
    useRoute: () => ({ params: { id: routeId }, query: {}, hash: '' }),
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => ref(true), useSsrQuerySeed: () => {},
    useMeetingSubmitError: () => ({ fieldErrors: computed(() => ({})), submitError: computed(() => '') }),
    usePatchMeeting: () => ({ mutateAsync: vi.fn(), isPending: ref(false), error: ref(null), reset: vi.fn() }),
    buildMeetingSchedulePayload: vi.fn(), getMeetingFormErrors: () => ({}), localDateFromUtc: () => '', localTimeFromUtc: () => '',
    navigateTo: vi.fn() }
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const exposed = new Function(...Object.keys(scope), `${js}; return { pageError, backTo, id }`)(...Object.values(scope))
  const queriedId = (useMeeting.mock.calls[0] as unknown as [{ value: number | null }])[0].value
  return { ...exposed, queriedId }
}

describe('meeting record pages with an invalid id', () => {
  it.each(['abc', '0', '08', '-3', '1e2'])('edit.vue shows not-found and queries nothing for %s', (routeId) => {
    const page = editPage(routeId)
    expect(page.id.value).toBeNull()
    expect(page.queriedId).toBeNull()
    expect(page.pageError.value).toBeInstanceOf(ApiError)
    expect(page.pageError.value.status).toBe(404)
    expect(page.pageError.value.code).toBe('not_found')
  })

  it('edit.vue keeps a valid id and has no page error', () => {
    const page = editPage('7')
    expect(page.queriedId).toBe(7)
    expect(page.pageError.value).toBeNull()
    expect(page.backTo.value).toMatchObject({ path: '/meetings/7' })
  })

  it('edit.vue returns to the list, never to "null", when the id is invalid', () => {
    const page = editPage('abc')
    expect(JSON.stringify(page.backTo.value)).not.toContain('null')
    expect(page.backTo.value).toMatchObject({ path: '/meetings' })
  })

  it.each(RECORD_PAGES)('%s parses its id strictly', (file) => {
    const source = sourceOf(file)
    expect(source).toContain('parsePositiveId(route.params.id)')
    expect(source).not.toContain('Number(route.params.id)')
    expect(source).toContain('new ApiError(404')
  })
})
