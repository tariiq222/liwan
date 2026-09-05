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
  it('keeps application screens free of modal business layers', () => {
    const violations = [...scanRoots.flatMap((root) => sourceFiles(join(appRoot, root))), ...activeUiComposites].flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      const reasons = [
        forbiddenTag.test(source) && 'forbidden overlay tag',
        forbiddenUiImport.test(source) && 'forbidden overlay primitive import',
        nativePopup.test(source) && 'native alert/confirm/prompt call',
      ].filter(Boolean)
      return reasons.map((reason) => `${relative(appRoot, path)}: ${reason}`)
    })

    expect(violations, violations.join('\n')).toEqual([])
  })
})
