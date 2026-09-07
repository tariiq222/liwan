import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, ref, watch } from 'vue'
import { describe, expect, it, vi } from 'vitest'

function form(file: string) {
  const source = readFileSync(resolve('app/pages/meetings', file), 'utf8')
  const script = parse(source).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const meeting = ref({ id: 7, name: 'Review', meeting_date: '2026-09-07', start_datetime: null,
    end_datetime: null, location: '', meeting_url: '', agenda: '<p>Agenda</p>', minutes: '', attendees: [], can_edit: true })
  const mutateAsync = vi.fn(async () => ({ id: 7 }))
  const navigateTo = vi.fn(async () => {})
  const scope = { computed, ref, watch, nextTick, useRoute: () => ({ params: { id: '7' }, query: {} }),
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => ref(true),
    useAccess: () => ({ can: () => true }), usePeople: () => ({}),
    useMeeting: () => ({ data: meeting }),
    usePatchMeeting: () => ({ mutateAsync, isPending: ref(false) }),
    useCreateMeeting: () => ({ mutateAsync, isPending: ref(false) }),
    useCreateResolution: () => ({ mutateAsync, isPending: ref(false) }),
    safeReturnTo: (_: unknown, fallback: string) => fallback, returnToQuery: () => ({}), navigateTo }
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  return { ...new Function(...Object.keys(scope), `${js}; return { dirty, name, save, ${file.includes('resolutions') ? 'responsibleId, deadline, priority' : 'end'} };`)(...Object.values(scope)), mutateAsync, navigateTo }
}

describe('meeting form unsaved changes', () => {
  it('edit starts clean, detects changes and becomes clean after saving', async () => {
    const page = form('[id]/edit.vue')
    expect(page.dirty.value).toBe(false)
    page.name.value = 'Changed'
    expect(page.dirty.value).toBe(true)
    await page.save()
    expect(page.dirty.value).toBe(false)
    expect(page.navigateTo).toHaveBeenCalled()
    expect(page.mutateAsync.mock.calls[0][0].body.agenda).toBe('<p>Agenda</p>')
  })
  it('new meeting tracks the end time and clears dirty after successful creation', async () => {
    const page = form('new.vue')
    page.end.value = '2026-09-07T16:30'
    expect(page.dirty.value).toBe(true)
    page.name.value = 'Created'
    await page.save()
    expect(page.dirty.value).toBe(false)
  })
  it('resolution tracks priority and clears dirty after successful creation', async () => {
    const page = form('[id]/resolutions/new.vue')
    page.priority.value = '3'
    expect(page.dirty.value).toBe(true)
    page.name.value = 'Follow up'
    page.responsibleId.value = 9
    page.deadline.value = '2026-09-10'
    await page.save()
    expect(page.dirty.value).toBe(false)
  })
})
