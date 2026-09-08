import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, ref, watch } from 'vue'
import { refDebounced } from '@vueuse/core'
import { describe, expect, it, vi } from 'vitest'

function page(file: string, pmo = false) {
  const source = parse(readFileSync(resolve('app/pages/meetings', file), 'utf8')).descriptor.scriptSetup!.content
  const route = { path: '/meetings/7', fullPath: '/meetings/7', params: { id: '7' }, query: { q: 'review', offset: '25' } }
  const replace = vi.fn(async ({ query }) => { route.query = query })
  const projects = vi.fn(() => ({ data: ref([]) }))
  const mutateAsync = vi.fn(async () => { throw new Error('backend unavailable') })
  const scope = { ref, computed, watch, useRoute: () => route, useRouter: () => ({ replace }),
    refDebounced,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => ref(true),
    useAccess: () => ({ can: () => pmo }), useProjects: projects,
    useMeetings: () => ({ data: ref({ total: 60 }), isFetching: ref(false) }),
    useMeeting: () => ({ data: ref({ can_edit: true }) }), useMeetingAttachments: () => ({}),
    useUploadMeetingAttachment: () => ({}), useDeleteMeetingAttachment: () => ({}),
    useConvertResolution: () => ({ mutateAsync }),
    safeReturnTo: (_: unknown, fallback: string) => fallback, ApiError: class ApiError extends Error {},
    navigateTo: vi.fn(), toast: { error: vi.fn() } }
  const ast = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true)
  const script = ast.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(ast)).join('\n')
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const exposed = file === 'index.vue' ? '{ setPage, offset }' : '{ convertResolution, projectByResolution, error: () => typeof conversionError === "undefined" ? null : conversionError.value }'
  return { ...new Function(...Object.keys(scope), `${js};return ${exposed}`)(...Object.values(scope)), route, projects, replace, mutateAsync }
}

describe('meeting route and conversion behavior', () => {
  it('removes the old offset on page one and preserves search for refresh/back', () => {
    const list = page('index.vue')
    list.setPage(1)
    expect(list.route.query.offset).toBeUndefined()
    expect(list.route.query.q).toBe('review')
    expect(list.offset.value).toBe(0)
  })
  it('does not enable project lookup for a meetings-only editor', () => {
    const detail = page('[id].vue')
    expect(detail.projects.mock.calls[0]?.[0]?.value).toBe(false)
  })
  it('shows a localized inline conversion failure', async () => {
    const detail = page('[id].vue', true)
    detail.projectByResolution.value[9] = 3
    await expect(detail.convertResolution(9)).resolves.toBeUndefined()
    expect(detail.error()).toBe('meetingsUi.convertError')
  })
})
