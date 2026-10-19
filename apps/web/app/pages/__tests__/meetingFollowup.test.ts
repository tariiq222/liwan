import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, ref, watch, toValue } from 'vue'
import { expect, it } from 'vitest'
import { firstQuery, parseOffset } from '../../utils/routeQuery'

function followup(state: string) {
  const script = parse(readFileSync('app/pages/meetings/follow-up.vue', 'utf8')).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  let request: unknown
  const scope = { computed, ref, watch, firstQuery, parseOffset,
    useRoute: () => ({ query: { state }, path: '/meetings/follow-up' }), useRouter: () => ({ replace: () => {} }),
    useI18n: () => ({ t: (key: string) => key, locale: ref('ar') }), useHydrated: () => ref(true), refDebounced: (value: unknown) => value,
    useMeetingFollowupKpis: () => ({ tiles: ref([]), loading: ref(false) }),
    useMeetingFollowup: (params: unknown) => { request = params; return { data: ref({ items: [], total: 0 }) } },
  }
  const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const page = new Function(...Object.keys(scope), `${js}; return { stateOptions }`)(...Object.values(scope))
  return { ...page, request: toValue(request as () => { state?: string }) }
}
it('offers all statuses and removes the state filter only for that explicit selection', () => {
  const page = followup('all')
  expect(page.stateOptions.value).toContainEqual({ value: 'all', label: 'meetingsUi.allStates' })
  expect(page.request.state).toBeUndefined()
  expect(followup('done').request.state).toBe('done')
  expect(followup('invalid').request.state).toBe('active')
})
