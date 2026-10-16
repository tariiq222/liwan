import { h, type VNode } from 'vue'
import type { MdBlock, MdInline } from './aiMarkdown'

const LINK_CLASS = 'text-primary underline underline-offset-2 break-words'
const INLINE_CODE_CLASS = 'rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em] text-highlighted'
const BLOCK_CLASS = 'break-words'

function renderInline(node: MdInline): VNode | string {
  switch (node.type) {
    case 'text': return node.value
    case 'br': return h('br')
    case 'strong': return h('strong', { class: 'font-semibold' }, node.children.map(renderInline))
    case 'em': return h('em', node.children.map(renderInline))
    case 'code': return h('code', { dir: 'ltr', class: INLINE_CODE_CLASS }, node.value)
    case 'link': return h('a', { href: node.href, target: '_blank', rel: 'noopener noreferrer nofollow', class: LINK_CLASS }, node.children.map(renderInline))
  }
}

function renderItems(items: MdInline[][]) {
  return items.map(item => h('li', { dir: 'auto' }, item.map(renderInline)))
}

function renderBlock(block: MdBlock): VNode {
  switch (block.type) {
    case 'p': return h('p', { dir: 'auto', class: [BLOCK_CLASS, block.strong && 'font-semibold'] }, block.children.map(renderInline))
    case 'ul': return h('ul', { dir: 'auto', class: `${BLOCK_CLASS} list-inside list-disc space-y-1 ps-1` }, renderItems(block.items))
    case 'ol': return h('ol', { dir: 'auto', start: block.start, class: `${BLOCK_CLASS} list-inside list-decimal space-y-1 ps-1` }, renderItems(block.items))
    case 'code': return h('pre', { dir: 'ltr', tabindex: 0, class: 'max-w-full overflow-x-auto rounded-md bg-muted p-3 text-start text-xs leading-5 text-highlighted' }, h('code', { class: 'font-mono' }, block.text))
    case 'table': return h('div', { class: 'max-w-full overflow-x-auto' }, h('table', { dir: 'auto', class: 'w-full border-collapse text-start text-xs' }, [
      h('thead', h('tr', block.head.map(cell => h('th', { class: 'border-b border-default px-2 py-1 text-start font-semibold' }, cell.map(renderInline))))),
      h('tbody', block.rows.map(row => h('tr', row.map(cell => h('td', { class: 'border-b border-default px-2 py-1 align-top' }, cell.map(renderInline)))))),
    ]))
    case 'raw': return h('p', { dir: 'auto', class: `${BLOCK_CLASS} whitespace-pre-wrap` }, block.text)
  }
}

export function renderMarkdownBlocks(blocks: MdBlock[]): VNode[] {
  return blocks.map(renderBlock)
}
