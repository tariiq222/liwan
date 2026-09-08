import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, ref, watch } from 'vue'
import { describe, expect, it, vi } from 'vitest'

function page(flags: { can_edit_decision: boolean; can_update_execution: boolean }) {
  const source = readFileSync(resolve('app/pages/meetings/[id]/resolutions/[resolutionId]/edit.vue'), 'utf8')
  const resolution = {
    id: 9,
    name: 'Confirm venue',
    deadline: '2026-09-10',
    priority: '1',
    state: 'in_progress',
    responsible: { id: 11, name: 'Amina' },
    task_id: null,
    result: '<p>Waiting for confirmation.</p>',
    ...flags,
  }
  const meeting = ref({
    id: 7,
    name: 'Weekly review',
    organizer: { id: 3, name: 'Tariq' },
    secretary: { id: 4, name: 'Sara' },
    attendees: [{ id: 11, name: 'Amina' }],
    resolutions: [resolution],
  })
  const mutateAsync = vi.fn(async () => resolution)
  const navigateTo = vi.fn(async () => {})
  const route = { params: { id: '7', resolutionId: '9' }, query: { returnTo: '/meetings?state=confirmed' } }
  const scope = {
    ref,
    computed,
    watch,
    nextTick,
    useRoute: () => route,
    useI18n: () => ({ t: (key: string) => key }),
    useHydrated: () => ref(true),
    useMeeting: () => ({ data: meeting, isLoading: ref(false), error: ref(null), refetch: vi.fn() }),
    usePatchResolution: () => ({ mutateAsync, isPending: ref(false), error: ref(null) }),
    safeReturnTo: (_value: unknown, fallback: string) => fallback,
    navigateTo,
  }
  const script = parse(source).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const js = ts.transpileModule(script, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  const exposed = '{ canEditDecision, canEditResult, canSave, knownPeople, name, responsibleId, deadline, priority, result, save }'
  return {
    ...new Function(...Object.keys(scope), `${js}; return ${exposed}`)(...Object.values(scope)),
    meeting,
    mutateAsync,
    navigateTo,
  }
}

describe('meeting resolution edit workflow', () => {
  it('saves all decision and execution fields for an organizer', async () => {
    const edit = page({ can_edit_decision: true, can_update_execution: true })

    expect(edit.canEditDecision.value).toBe(true)
    expect(edit.canEditResult.value).toBe(true)
    edit.name.value = 'Confirm the new venue'
    edit.responsibleId.value = 4
    edit.deadline.value = '2026-09-12'
    edit.priority.value = '3'
    edit.result.value = '<p>Venue confirmed.</p>'
    await edit.save()

    expect(edit.mutateAsync).toHaveBeenCalledWith({
      meetingId: 7,
      resolutionId: 9,
      body: {
        name: 'Confirm the new venue',
        responsible_id: 4,
        deadline: '2026-09-12',
        priority: '3',
        result: '<p>Venue confirmed.</p>',
      },
    })
    expect(edit.navigateTo).toHaveBeenCalledWith('/meetings/7')
  })

  it('saves only the execution result for an assignee', async () => {
    const edit = page({ can_edit_decision: false, can_update_execution: true })

    expect(edit.canEditDecision.value).toBe(false)
    expect(edit.canEditResult.value).toBe(true)
    edit.result.value = '<p>Venue confirmed.</p>'
    await edit.save()

    expect(edit.mutateAsync).toHaveBeenCalledWith({
      meetingId: 7,
      resolutionId: 9,
      body: { result: '<p>Venue confirmed.</p>' },
    })
  })

  it('does not patch when a required decision field is cleared', async () => {
    const edit = page({ can_edit_decision: true, can_update_execution: true })

    edit.responsibleId.value = ''
    edit.deadline.value = ''
    await edit.save()

    expect(edit.mutateAsync).not.toHaveBeenCalled()
  })

  it('keeps the current responsible person selectable when attendees change', () => {
    const edit = page({ can_edit_decision: true, can_update_execution: true })

    edit.meeting.value.attendees = []

    expect(edit.knownPeople.value).toEqual(expect.arrayContaining([{ id: 11, name: 'Amina' }]))
  })

  it('does not expose a save operation for converted or archived recommendations', async () => {
    const edit = page({ can_edit_decision: false, can_update_execution: false })

    expect(edit.canSave.value).toBe(false)
    edit.result.value = '<p>Should remain unchanged.</p>'
    await edit.save()

    expect(edit.mutateAsync).not.toHaveBeenCalled()
    expect(edit.navigateTo).not.toHaveBeenCalled()
  })
})
