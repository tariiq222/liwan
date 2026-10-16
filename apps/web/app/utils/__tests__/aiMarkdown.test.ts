import { describe, expect, it } from 'vitest'
import { parseMarkdown, type MdBlock, type MdInline } from '../aiMarkdown'

const inlines = (text: string): MdInline[] => {
  const [block] = parseMarkdown(text)
  if (!block || block.type !== 'p') throw new Error(`expected a paragraph, got ${block?.type}`)
  return block.children
}
const plain = (nodes: MdInline[]): string =>
  nodes.map(n => (n.type === 'text' ? n.value : n.type === 'br' ? '\n' : n.type === 'code' ? n.value : plain(n.children))).join('')

describe('parseMarkdown inline', () => {
  it('parses bold, italic and inline code', () => {
    expect(inlines('a **b** c *d* e `f`')).toEqual([
      { type: 'text', value: 'a ' }, { type: 'strong', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: ' c ' }, { type: 'em', children: [{ type: 'text', value: 'd' }] },
      { type: 'text', value: ' e ' }, { type: 'code', value: 'f' },
    ])
  })

  it('keeps markers inside inline code literal', () => {
    expect(inlines('`**x**`')).toEqual([{ type: 'code', value: '**x**' }])
  })

  it('turns single newlines into line breaks', () => {
    expect(inlines('a\nb').map(n => n.type)).toEqual(['text', 'br', 'text'])
  })

  it('parses Arabic text around markers', () => {
    const nodes = inlines('عندك **مهمتان** متأخرتان و`code`')
    expect(nodes.map(n => n.type)).toEqual(['text', 'strong', 'text', 'code'])
    expect(plain(nodes)).toBe('عندك مهمتان متأخرتان وcode')
  })

  it('keeps snake_case words intact', () => {
    expect(plain(inlines('use my_var_name here'))).toBe('use my_var_name here')
  })

  it.each([
    '**unterminated', 'a ** b', '*', '**', '`open', '[label](https://exa', '[label](', '[label', '**bold*', '****', '` `',
  ])('leaves incomplete markup %j as plain text', (text) => {
    const nodes = inlines(text)
    expect(nodes.every(n => n.type === 'text')).toBe(true)
    expect(plain(nodes)).toBe(text)
  })

  it('handles nested and unbalanced markers without throwing', () => {
    for (const text of ['***a**', '**a*b**c*', '*a**b*', '**__*`', '*a *b* c', '**a **b** c**', '__proto__', '**__proto__**', 'constructor.prototype'])
      expect(() => parseMarkdown(text)).not.toThrow()
    expect(plain(inlines('__proto__ and constructor'))).toBe('__proto__ and constructor')
  })
})

describe('parseMarkdown links', () => {
  const link = (text: string) => inlines(text).find(n => n.type === 'link')

  it.each(['https://example.com/a?b=1', 'http://example.com', 'mailto:a@example.com', 'HTTPS://EXAMPLE.COM'])('allows %s', (href) => {
    expect(link(`see [label](${href}) now`)).toEqual({ type: 'link', href, children: [{ type: 'text', value: 'label' }] })
  })

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x',
    '//evil.example', '/relative/path', 'relative', 'https:evil', 'ftp://x', 'https://a b', 'java\tscript:alert(1)',
  ])('does not link %j', (href) => {
    const nodes = inlines(`[x](${href})`)
    expect(nodes.some(n => n.type === 'link')).toBe(false)
    expect(plain(nodes)).not.toMatch(/javascript:|data:|vbscript:/i)
    expect(plain(nodes).startsWith('x')).toBe(true)
  })

  it('shows relative and protocol-relative URLs in parentheses', () => {
    expect(plain(inlines('[x](//evil.example)'))).toBe('x (//evil.example)')
    expect(plain(inlines('[x](/projects/5)'))).toBe('x (/projects/5)')
  })

  it('leaves images literal', () => {
    const nodes = inlines('![i](https://x/y.png)')
    expect(nodes.some(n => n.type === 'link')).toBe(false)
    expect(plain(nodes)).toBe('![i](https://x/y.png)')
  })

  it('never produces markup from raw html', () => {
    const nodes = inlines('<script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(nodes.every(n => n.type === 'text')).toBe(true)
    expect(plain(nodes)).toBe('<script>alert(1)</script> <img src=x onerror=alert(1)>')
  })
})

describe('parseMarkdown blocks', () => {
  it('splits paragraphs on blank lines', () => {
    expect(parseMarkdown('one\n\ntwo').map(b => b.type)).toEqual(['p', 'p'])
  })

  it('parses unordered lists with nested bold', () => {
    const [list] = parseMarkdown('- **أولاً** مهمة\n* ثانياً\n+ third')
    expect(list).toMatchObject({ type: 'ul' })
    const items = (list as Extract<MdBlock, { type: 'ul' }>).items
    expect(items).toHaveLength(3)
    expect(items[0]![0]).toEqual({ type: 'strong', children: [{ type: 'text', value: 'أولاً' }] })
  })

  it('parses ordered lists and keeps the start number', () => {
    const [list] = parseMarkdown('3. a\n4. **b**\n5) c')
    expect(list).toMatchObject({ type: 'ol', start: 3 })
    expect((list as Extract<MdBlock, { type: 'ol' }>).items).toHaveLength(3)
  })

  it('separates a list from the paragraph around it', () => {
    expect(parseMarkdown('intro:\n- a\n- b\nafter\n\nend').map(b => b.type)).toEqual(['p', 'ul', 'p', 'p'])
  })

  it('renders headings as bold paragraphs', () => {
    const [block] = parseMarkdown('## عنوان **x**')
    expect(block).toMatchObject({ type: 'p', strong: true })
  })

  it('parses a closed fenced code block verbatim', () => {
    const [block] = parseMarkdown('```ts\nconst a = **1**\n<b>x</b>\n```')
    expect(block).toEqual({ type: 'code', lang: 'ts', text: 'const a = **1**\n<b>x</b>' })
  })

  it('keeps an open fence as plain text until it closes', () => {
    const blocks = parseMarkdown('before\n```js\nconst a = 1')
    expect(blocks.map(b => b.type)).toEqual(['p', 'raw'])
    expect(blocks[1]).toEqual({ type: 'raw', text: '```js\nconst a = 1' })
  })

  it('leaves footnotes literal', () => {
    expect(plain(inlines('text[^1]\n\n[^1]: note'))).toBe('text[^1]')
  })

  it('returns no blocks for empty text', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('  \n\n ')).toEqual([])
  })
})

const sample = [
  '## ملخص **المشاريع**', '', 'عندك **ثلاثة** مشاريع، منها `alpha` و*beta*.', '',
  '1. [الأول](https://example.com/a) متأخر', '2. **الثاني** جيد', '', '- bullet one', '- bullet **two**', '',
  '```ts', 'const x = "**not bold**"', '```', '', '![img](https://x/y.png) <b>raw</b> [bad](javascript:alert(1))',
].join('\n')

describe('parseMarkdown streaming', () => {
  it('never throws on any prefix of a sample answer', () => {
    for (let i = 0; i <= sample.length; i++) expect(() => parseMarkdown(sample.slice(0, i))).not.toThrow()
  })

  it('never emits a link for a dangerous href in any prefix', () => {
    for (let i = 0; i <= sample.length; i++) {
      const json = JSON.stringify(parseMarkdown(sample.slice(0, i)))
      expect(json).not.toMatch(/"href":"(?!https?:|mailto:)/i)
    }
  })
})

describe('parseMarkdown performance', () => {
  const pathological = [
    '*'.repeat(50_000), '**a '.repeat(12_500), '['.repeat(50_000), '[a]('.repeat(10_000), '[a](' + 'b'.repeat(50_000),
    '`'.repeat(50_000), '`a '.repeat(16_000), '_'.repeat(50_000), '- '.repeat(25_000), '```\n'.repeat(12_500),
    '*a**b'.repeat(10_000), '['.repeat(25_000) + '](' + 'x'.repeat(100),
  ]
  it.each(pathological.map((text, i) => [i, text] as const))('finishes pathological input %i quickly', (_i, text) => {
    const start = performance.now()
    parseMarkdown(text)
    expect(performance.now() - start).toBeLessThan(500)
  })

  it('parses a pipe table and pads short rows', () => {
    const blocks = parseMarkdown('| المهمة | الحالة |\n|---|:---:|\n| تقرير | **متأخرة** |\n| وثيقة |')
    expect(blocks).toHaveLength(1)
    const table = blocks[0] as Extract<(typeof blocks)[number], { type: 'table' }>
    expect(table.type).toBe('table')
    expect(table.head).toHaveLength(2)
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]![1]![0]).toMatchObject({ type: 'strong' })
    expect(table.rows[1]).toHaveLength(2)
  })
  it('keeps a pipe line without a separator row as a paragraph', () => {
    expect(parseMarkdown('| a | b |')[0]!.type).toBe('p')
  })
})
