import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { projectEntryLocation, savedProjectLocation } from '../../utils/projectWorkspaceMemory'

// Execute the real auto-imported composable with browser storage and identity supplied at its edges.
const source = readFileSync(new URL('../useProjectWorkspaceMemory.ts', import.meta.url), 'utf8')
  .replace(/^import .*\n/, '').replaceAll('import.meta.client', 'true')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function memory(capabilities: string[], savedPath: string) {
  const stored = JSON.stringify({ path: savedPath, query: { view: 'board', q: 'review' } })
  const exports: Record<string, any> = {}
  new Function('exports', 'useMe', 'useHydrated', 'localStorage', 'projectEntryLocation', 'savedProjectLocation', js)(
    exports, () => ({ me: ref({ id: 2, company: { id: 1 }, capabilities }) }), () => ref(true),
    { getItem: () => stored, setItem: () => {} }, projectEntryLocation, savedProjectLocation,
  )
  return exports.useProjectWorkspaceMemory()
}

describe('project reentry access', () => {
  it.each(['tasks', 'milestones', 'schedule'])('falls back to summary when task read was revoked from a saved %s section', section => {
    expect(memory(['pmo.projects.read'], `/projects/7/${section}`).entryTo(7, '/projects?mine=1')).toEqual({
      path: '/projects/7', query: { returnTo: '/projects?mine=1', projectListReturnTo: '/projects?mine=1' },
    })
  })
  it('keeps an authorized canonical task board on reentry', () => {
    expect(memory(['pmo.projects.read', 'pmo.tasks.read'], '/projects/7/tasks').entryTo(7, '/projects')).toEqual({
      path: '/projects/7/tasks', query: { view: 'board', q: 'review', returnTo: '/projects', projectListReturnTo: '/projects' },
    })
  })
})
