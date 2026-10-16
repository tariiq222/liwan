/**
 * Dependency-free parser for the small markdown subset the assistant writes.
 * It returns a plain AST and never HTML: rendering happens in Vue (aiMarkdownRender.ts),
 * so every text node is escaped. Anything outside the subset stays literal text, and
 * incomplete markup (a streaming prefix) stays literal until it is completed.
 */
export type MdInline =
  | { type: 'text', value: string }
  | { type: 'br' }
  | { type: 'strong' | 'em', children: MdInline[] }
  | { type: 'code', value: string }
  | { type: 'link', href: string, children: MdInline[] }

export type MdBlock =
  | { type: 'p', children: MdInline[], strong?: true }
  | { type: 'ul', items: MdInline[][] }
  | { type: 'ol', start: number, items: MdInline[][] }
  | { type: 'code', lang: string, text: string }
  | { type: 'table', head: MdInline[][], rows: MdInline[][][] }
  | { type: 'raw', text: string }

const MAX_INLINE_DEPTH = 3
const MAX_LABEL_LENGTH = 300
const MAX_URL_LENGTH = 2000
const ALLOWED_HREF = /^(?:https?:\/\/[^\s<>"'\\]+|mailto:[^\s<>"'\\]+)$/i
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const FENCE_OPEN = /^ {0,3}```([\w+-]{0,20})[ \t]*$/
const FENCE_CLOSE = /^ {0,3}```[ \t]*$/
const HEADING = /^ {0,3}#{1,6} +(\S.*)$/
const BULLET = /^ {0,8}[-*+] +(\S.*)$/
const ORDERED = /^ {0,8}(\d{1,9})[.)] +(\S.*)$/
const BLANK = /^\s*$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|(?:\s*:?-{1,}:?\s*\|)+\s*$/
const MAX_TABLE_ROWS = 200

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function hasEdgeSpace(text: string) {
  return /^\s|\s$/.test(text)
}

function blockedLink(label: string, destination: string): MdInline[] {
  const compact = destination.replace(/[\s\u0000-\u001f]/g, '')
  return [{ type: 'text', value: URL_SCHEME.test(compact) ? label : `${label} (${destination.trim()})` }]
}

function parseInline(src: string, depth: number): MdInline[] {
  const out: MdInline[] = []
  const exhausted = new Set<string>()
  let buffer = ''
  let i = 0

  const flush = () => {
    if (buffer) out.push({ type: 'text', value: buffer })
    buffer = ''
  }
  const push = (node: MdInline[] | MdInline) => {
    flush()
    if (Array.isArray(node)) out.push(...node)
    else out.push(node)
  }
  // A marker that is missing after position p is missing after every later position too.
  const find = (marker: string, from: number) => {
    if (exhausted.has(marker)) return -1
    const index = src.indexOf(marker, from)
    if (index < 0) exhausted.add(marker)
    return index
  }
  const nested = (content: string) => (depth < MAX_INLINE_DEPTH ? parseInline(content, depth + 1) : [{ type: 'text', value: content } as MdInline])

  const closeSingleStar = (from: number) => {
    let j = find('*', from)
    while (j >= 0 && src[j + 1] === '*') j = src.indexOf('*', j + 2)
    if (j < 0) exhausted.add('*')
    return j
  }

  const tryLink = (): boolean => {
    if (src[i - 1] === '!') return false
    const labelStart = i + 1
    const limit = Math.min(src.length, labelStart + MAX_LABEL_LENGTH)
    let end = labelStart
    while (end < limit && src[end] !== ']' && src[end] !== '[' && src[end] !== '\n') end++
    if (src[end] !== ']' || end === labelStart || src[end + 1] !== '(') return false
    const urlStart = end + 2
    const urlLimit = Math.min(src.length, urlStart + MAX_URL_LENGTH)
    let close = urlStart
    let open = 0
    while (close < urlLimit && src[close] !== '\n' && (src[close] !== ')' || open > 0)) {
      if (src[close] === '(') open++
      else if (src[close] === ')') open--
      close++
    }
    if (src[close] !== ')') return false
    const label = src.slice(labelStart, end)
    const destination = src.slice(urlStart, close)
    const href = destination.trim()
    push(ALLOWED_HREF.test(href) ? { type: 'link', href, children: [{ type: 'text', value: label }] } : blockedLink(label, destination))
    i = close + 1
    return true
  }

  while (i < src.length) {
    const c = src[i]!
    if (c === '\n') {
      push({ type: 'br' })
      i++
    } else if (c === '`') {
      let run = 1
      while (src[i + run] === '`') run++
      const j = run === 1 ? find('`', i + 1) : -1
      const content = j > i + 1 && src[j + 1] !== '`' ? src.slice(i + 1, j) : ''
      if (content.trim() && !content.includes('\n')) {
        push({ type: 'code', value: content })
        i = j + 1
      } else {
        buffer += '`'.repeat(run)
        i += run
      }
    } else if (c === '*' && src[i + 1] === '*') {
      const j = find('**', i + 2)
      const content = j > i + 2 ? src.slice(i + 2, j) : ''
      if (content && !hasEdgeSpace(content)) {
        push({ type: 'strong', children: nested(content) })
        i = j + 2
      } else {
        buffer += '**'
        i += 2
      }
    } else if (c === '*') {
      const j = closeSingleStar(i + 1)
      const content = j > i + 1 ? src.slice(i + 1, j) : ''
      if (content && !hasEdgeSpace(content)) {
        push({ type: 'em', children: nested(content) })
        i = j + 1
      } else {
        buffer += c
        i++
      }
    } else if (c === '[' && tryLink()) {
      // handled
    } else {
      buffer += c
      i++
    }
  }
  flush()
  return out
}

export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let paragraph: string[] = []
  let list: { type: 'ul' | 'ol', start: number, items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'p', children: parseInline(paragraph.join('\n'), 0) })
    paragraph = []
  }
  const flushList = () => {
    if (list) {
      const items = list.items.map(item => parseInline(item, 0))
      blocks.push(list.type === 'ol' ? { type: 'ol', start: list.start, items } : { type: 'ul', items })
    }
    list = null
  }
  const addItem = (type: 'ul' | 'ol', content: string, start: number) => {
    flushParagraph()
    if (list && list.type !== type) flushList()
    if (!list) list = { type, start, items: [] }
    list.items.push(content)
  }

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!
    const fence = FENCE_OPEN.exec(line)
    if (fence) {
      flushParagraph()
      flushList()
      const close = lines.findIndex((candidate, index) => index > n && FENCE_CLOSE.test(candidate))
      if (close < 0) {
        blocks.push({ type: 'raw', text: lines.slice(n).join('\n') })
        break
      }
      blocks.push({ type: 'code', lang: fence[1]!, text: lines.slice(n + 1, close).join('\n') })
      n = close
      continue
    }
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[n + 1] ?? '')) {
      flushParagraph()
      flushList()
      const width = splitRow(line).length
      const rows: MdInline[][][] = []
      let end = n + 2
      while (end < lines.length && TABLE_ROW.test(lines[end]!) && rows.length < MAX_TABLE_ROWS) {
        const cells = splitRow(lines[end]!).slice(0, width)
        while (cells.length < width) cells.push('')
        rows.push(cells.map(cell => parseInline(cell, 0)))
        end++
      }
      blocks.push({ type: 'table', head: splitRow(line).map(cell => parseInline(cell, 0)), rows })
      n = end - 1
      continue
    }
    const bullet = BULLET.exec(line)
    const ordered = bullet ? null : ORDERED.exec(line)
    const heading = bullet || ordered ? null : HEADING.exec(line)
    if (bullet) addItem('ul', bullet[1]!, 1)
    else if (ordered) addItem('ol', ordered[2]!, Number(ordered[1]))
    else if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'p', strong: true, children: parseInline(heading[1]!, 0) })
    } else if (BLANK.test(line)) flushParagraph()
    else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  return blocks
}
