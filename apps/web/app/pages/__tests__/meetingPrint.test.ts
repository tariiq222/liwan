import * as recordNavigation from './helpers/recordNavigation'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { formatMeetingDate, selectMeetingMinutesSource } from '../../utils/meetingMinutesForm'
import { parsePositiveId } from '../../utils/routeParams'

const version = { number: 3, snapshot: { meeting_date: '2026-09-07', agenda: '<p>Old agenda</p>', minutes: '<p>Old minutes</p>', minutes_form: null, resolutions: [] } }

function printPage(routeId: string, versionId?: string) {
  const script = parse(readFileSync(resolve('app/pages/meetings/[id]/print.vue'), 'utf8')).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '').replaceAll('import.meta.client', 'true')
  const meeting = ref({ id: 7, name: 'Review', meeting_date: '2026-09-14', state: 'confirmed', minutes: '', minutes_form: null, agenda: '<p>A</p>', resolutions: [] })
  const scope = { ...recordNavigation, computed, ref, parsePositiveId, ApiError, formatMeetingDate, selectMeetingMinutesSource,
    useRoute: () => ({ params: { id: routeId }, query: versionId === undefined ? {} : { version_id: versionId }, hash: '' }),
    useI18n: () => ({ t: (key: string, params?: { number?: number }) => params?.number ? `${key}:${params.number}` : key, locale: ref('en') }),
    useHydrated: () => ref(true), useBranding: () => ({ branding: ref(null) }), usePageHeader: () => {}, useEscapeBack: () => {},
    useMeeting: (id: { value: number | null }) => ({ data: computed(() => id.value === 7 ? meeting.value : undefined), error: ref(null), isLoading: ref(false), refetch: () => {} }),
    useMeetingVersion: (_: unknown, vid: { value: number | null }) => ({ data: computed(() => vid.value === 3 ? version : undefined), error: ref(null), isLoading: ref(false), refetch: () => {} }) }
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  return new Function(...Object.keys(scope), `${js}; return { printReady, legacyAgenda, legacyMinutes, facts, printableDate, printError, backTo }`)(...Object.values(scope))
}

describe('meeting print page', () => {
  it('prints the requested version, not the current content', () => {
    const page = printPage('7', '3')
    expect(page.printReady.value).toBe(true)
    expect(page.legacyAgenda.value).toBe('<p>Old agenda</p>')
    expect(page.legacyMinutes.value).toBe('<p>Old minutes</p>')
    expect(page.printableDate.value).toBe('2026-09-07')
    const fact = page.facts.value.find((item: { key: string }) => item.key === 'version')
    expect(fact?.value).toBe('meetingMinutesForm.versionNumber:3')
  })

  it('ignores an invalid version id and prints the current content without version facts', () => {
    const page = printPage('7', 'x')
    expect(page.printReady.value).toBe(true)
    expect(page.legacyAgenda.value).toBe('<p>A</p>')
    expect(page.printableDate.value).toBe('2026-09-14')
    expect(page.facts.value.some((item: { key: string }) => item.key === 'version')).toBe(false)
  })

  it('shows not-found for an invalid meeting id and links back to the list', () => {
    const page = printPage('abc')
    expect(page.printReady.value).toBe(false)
    expect(page.printError.value).toBeInstanceOf(ApiError)
    expect(page.printError.value.status).toBe(404)
    expect(page.backTo.value).toMatchObject({ path: '/meetings' })
  })
})
