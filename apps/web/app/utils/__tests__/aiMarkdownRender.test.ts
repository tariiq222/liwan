import { renderToString } from '@vue/server-renderer'
import { createSSRApp, defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../aiMarkdown'
import { renderMarkdownBlocks } from '../aiMarkdownRender'

const html = (text: string) =>
  renderToString(createSSRApp(defineComponent({ render: () => h('div', renderMarkdownBlocks(parseMarkdown(text))) })))

const vectors = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '![i](https://x/y.png)',
  '[x](//evil.example)',
  '**<script>alert(1)</script>**',
  '- <img src=x onerror=alert(1)>',
  '```\n<script>alert(1)</script>\n```',
  '`<script>alert(1)</script>`',
  '[<img src=x onerror=alert(1)>](https://example.com)',
  '[a](https://example.com/"onmouseover="alert(1))',
  '__proto__ **__proto__**',
]

describe('renderMarkdownBlocks', () => {
  it.each(vectors)('emits no executable markup for %j', async (text) => {
    const out = await html(text)
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<img')
    expect(out).not.toMatch(/<[^>]*\bon\w+\s*=/i)
    expect(out).not.toMatch(/href="\s*(?!https?:|mailto:)/i)
    expect(out).not.toMatch(/href="[^"]*"[^>]*\s(?:onmouseover|onclick)=/i)
  })

  it('never writes a dangerous scheme into the output for link vectors', async () => {
    for (const text of vectors.slice(2, 5)) expect(await html(text)).not.toMatch(/javascript:|data:text/i)
  })

  it('renders strong, lists and safe links', async () => {
    const out = await html('عندك **مهمتان**\n\n- **a** one\n- two\n\n1. x\n2. y\n\n[موقع](https://example.com/a?b=1&c=2)')
    expect(out).toContain('<strong')
    expect(out).toContain('<ul')
    expect(out).toContain('<ol')
    expect(out).toContain('<li')
    expect(out).toMatch(/<a [^>]*href="https:\/\/example.com\/a\?b=1&amp;c=2"/)
    expect(out).toMatch(/<a [^>]*rel="noopener noreferrer nofollow"/)
    expect(out).toMatch(/<a [^>]*target="_blank"/)
  })

  it('gives every block dir=auto and keeps code blocks ltr', async () => {
    const out = await html('para\n\n- item\n\n```\ncode\n```')
    expect(out).toMatch(/<p [^>]*dir="auto"/)
    expect(out).toMatch(/<ul [^>]*dir="auto"/)
    expect(out).toMatch(/<li [^>]*dir="auto"/)
    expect(out).toMatch(/<pre [^>]*dir="ltr"/)
  })

  it('renders an open fence and half-written markup as plain text', async () => {
    const out = await html('**bold\n\n[a](https://exa\n\n```js\nlet a')
    expect(out).not.toContain('<strong')
    expect(out).not.toContain('<a ')
    expect(out).not.toContain('<pre')
    expect(out).toContain('**bold')
    expect(out).toContain('```js')
  })

  it('escapes text so raw html shows literally', async () => {
    expect(await html('<b>x</b>')).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})
