import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const scanRoots = ['pages', 'layouts', 'components']
const activeUiComposites = [join(appRoot, 'components/ui/sidebar/Sidebar.vue')]
const forbiddenTag = /<\/?(?:Dialog|AlertDialog|Sheet|Drawer|CommandDialog)(?:\s|>)/
const forbiddenUiImport = /components\/ui\/(?:dialog|alert-dialog|sheet|drawer)(?:['"/]|$)|components\/ui\/command\/CommandDialog(?:\.vue)?['"]/
const nativePopup = /(?:\bwindow\s*\.\s*)?\b(?:alert|confirm|prompt)\s*\(/

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (relative(appRoot, path) === 'components/ui') return []
      return sourceFiles(path)
    }
    return ['.vue', '.ts'].includes(extname(entry.name)) ? [path] : []
  })
}

describe('business overlay architecture', () => {
  it('limits business dialogs to the approved header search and project route host', () => {
    const violations = [...scanRoots.flatMap((root) => sourceFiles(join(appRoot, root))), ...activeUiComposites].flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      // Exact-file exceptions: header search (2026-09-06) and the Projects pilot
      // (2026-09-09). Other modules and native prompts remain disallowed.
      const allowsDialog = [
        'components/GlobalSearch.vue',
        'components/project/workspace/ProjectRouteModal.vue',
      ].includes(relative(appRoot, path))
      const reasons = [
        !allowsDialog && forbiddenTag.test(source) && 'forbidden overlay tag',
        !allowsDialog && forbiddenUiImport.test(source) && 'forbidden overlay primitive import',
        nativePopup.test(source) && 'native alert/confirm/prompt call',
      ].filter(Boolean)
      return reasons.map((reason) => `${relative(appRoot, path)}: ${reason}`)
    })

    expect(violations, violations.join('\n')).toEqual([])
  })
})
