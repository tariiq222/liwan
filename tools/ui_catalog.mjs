// Machine-readable catalog of the Storybook components, for agents designing pages.
// Generated from STORYBOOK_COMPONENTS (tools/ui_policy.py), the stories and the real
// component types; never edited by hand. `--check` fails when the file is stale.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createChecker } from 'vue-component-meta'

const root = fileURLToPath(new URL('..', import.meta.url))
const OUTPUT = 'docs/design-system/catalog.json'
const STORIES = 'apps/web/stories'
const LAYER_PREFIX = '@nasq/ui/'
const TSCONFIG = 'apps/web/.nuxt/tsconfig.app.json'
const AUTO_IMPORTS = 'apps/web/.nuxt/components.d.ts'

function walk(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? entry.name === '__tests__' ? [] : walk(`${dir}/${entry.name}`)
    : entry.name.endsWith('.stories.ts') ? [`${dir}/${entry.name}`] : [])
}

function readStory(file) {
  const source = readFileSync(path.join(root, file), 'utf8')
  const imports = new Map([...source.matchAll(/^\s*import\s+(\w+)\s+from\s+['"]([^'"]+\.vue)['"]/gm)]
    .map(match => [match[1], match[2].startsWith(LAYER_PREFIX)
      ? `packages/ui/${match[2].slice(LAYER_PREFIX.length)}`
      : path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2]))]))
  // Each story runs to the next export; the text before the first one is the meta,
  // whose storyContext covers stories that do not cite their own.
  const [head, ...parts] = source.split(/^export const (?=\w+: Story(?:Obj)?\b)/m)
  const context = text => text.match(/storyContext\(\s*['"]([^'"]+)['"]/)?.[1] ?? null
  const stories = parts.map(body => ({
    id: body.match(/^\w+/)[0],
    name: body.match(/\bname:\s*'([^']+)'/)?.[1] ?? body.match(/^\w+/)[0],
    context: context(body),
    base: body.match(/=\s*\{\s*\.\.\.(\w+)/)?.[1],
  }))
  // A story that spreads a sibling (`{ ...InTableCell, ... }`) keeps that sibling's context.
  for (const story of stories) {
    story.context ??= stories.find(other => other.id === story.base)?.context ?? context(head)
    delete story.base
  }
  return {
    file,
    title: source.match(/\btitle:\s*'([^']+)'/)?.[1] ?? null,
    component: imports.get(source.match(/\bcomponent:\s*(\w+)/)?.[1]) ?? null,
    description: source.match(/description:\s*\{\s*component:\s*'([^']+)'/)?.[1] ?? null,
    stories,
  }
}

// Imported type aliases print through the global scope (`globalThis.ShellRailItem`); the alias name is the documented type.
const optional = type => type.replace(/ \| undefined$/, '').replaceAll('globalThis.', '')
// Bundled library types print as minified names (`it | et`); the declared text is clearer.
const declared = (source, prop, type) => /(^|[ |])[a-z]{1,2}($|[ |])/.test(type)
  ? source.match(new RegExp(`^\\s*${prop}\\??:\\s*([^\\n,]+)`, 'm'))?.[1].trim() ?? type
  : type

function build() {
  for (const file of [TSCONFIG, AUTO_IMPORTS]) {
    if (!existsSync(path.join(root, file))) throw new Error(`${file} is missing; run "npm -w apps/web run postinstall" (nuxt prepare) first`)
  }
  const listed = JSON.parse(execFileSync('python3', ['-B', '-c',
    'import json, ui_policy; print(json.dumps(ui_policy.STORYBOOK_COMPONENTS))'], { cwd: path.join(root, 'tools'), encoding: 'utf8' }))
  const autoImports = readFileSync(path.join(root, AUTO_IMPORTS), 'utf8')
  const storyFiles = walk(STORIES).sort().map(readStory)
  const checker = createChecker(path.join(root, TSCONFIG), { forceUseTs: true, noDeclarations: true })

  const components = listed.map((file) => {
    const story = storyFiles.find(candidate => candidate.component === file)
    const meta = checker.getComponentMeta(path.join(root, file))
    const importPath = path.posix.relative('apps/web/.nuxt', file)
    const name = autoImports.match(new RegExp(`^export const (\\w+): typeof import\\("${importPath.replaceAll('.', '\\.')}"\\)`, 'm'))?.[1]
    const source = readFileSync(path.join(root, file), 'utf8')
    const template = source.match(/<template>[\s\S]*<\/template>/)?.[0] ?? ''
    return {
      name: name ?? path.basename(file, '.vue'),
      file,
      story: story?.file ?? null,
      title: story?.title ?? null,
      props: meta.props.filter(prop => !prop.global).map(prop => ({
        name: prop.name,
        type: declared(source, prop.name, optional(prop.type)),
        required: prop.required,
        ...(prop.default === undefined ? {} : { default: prop.default }),
        ...(prop.description ? { description: prop.description } : {}),
      })),
      events: meta.events.map(event => ({ name: event.name, payload: event.type.replaceAll('globalThis.', '') })),
      slots: meta.slots.map(slot => slot.name),
      nuxtUi: [...new Set([...template.matchAll(/<(U[A-Z]\w*)/g)].map(match => match[1]))].sort(),
      stories: story?.stories ?? [],
    }
  }).sort((a, b) => a.file.localeCompare(b.file))

  const recipes = storyFiles.filter(story => !story.component && story.stories.length).map(story => ({
    title: story.title,
    story: story.file,
    ...(story.description ? { description: story.description } : {}),
    stories: story.stories.map(({ id, name }) => ({ id, name })),
  }))

  return `${JSON.stringify({
    note: `Generated by tools/ui_catalog.mjs; do not edit. Policy: DESIGN.md. Open a component's story for usage; "context" is the real page line it copies.`,
    components,
    recipes,
  }, null, 2)}\n`
}

const expected = build()
const target = path.join(root, OUTPUT)
if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== expected) {
    console.error(`${OUTPUT} is stale; run "node tools/ui_catalog.mjs"`)
    process.exitCode = 1
  } else console.log(`UI catalog: ${JSON.parse(expected).components.length} components, up to date`)
} else {
  writeFileSync(target, expected)
  console.log(`Wrote ${OUTPUT}: ${JSON.parse(expected).components.length} components`)
}
