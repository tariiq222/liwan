import { createSSRApp, defineComponent, h, KeepAlive, Transition, TransitionGroup, useId, type App } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { keepBuiltInsOutOfIdTree } from '../hydrationIds'

// The app's global serverPrefetch mixin (plugins/vue-query.ts) makes every stateful component a `useId` boundary. A built-in wrapper
// the server never instantiates (Nuxt renders the page <Transition> on the client only) must not change the ids under it.
const Field = defineComponent({ setup: () => { const id = useId(); return () => h('input', { id }) } })
const ids = (html: string) => [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1])

async function render(wrap: (child: ReturnType<typeof h>) => ReturnType<typeof h>, { exclude }: { exclude: boolean }) {
  const app: App = createSSRApp({ render: () => wrap(h(Field)) })
  app.mixin({ serverPrefetch: () => undefined })
  if (exclude) keepBuiltInsOutOfIdTree(app)
  return ids(await renderToString(app))
}

describe('keepBuiltInsOutOfIdTree', () => {
  const bare = (child: ReturnType<typeof h>) => child
  const wrappers = {
    Transition: (child: ReturnType<typeof h>) => h(Transition, null, { default: () => child }),
    TransitionGroup: (child: ReturnType<typeof h>) => h(TransitionGroup, { tag: 'div' }, { default: () => [child] }),
    KeepAlive: (child: ReturnType<typeof h>) => h(KeepAlive, null, { default: () => child }),
  }

  it.each(Object.entries(wrappers))('leaves the ids under a %s as they are without it', async (_name, wrap) => {
    expect(await render(wrap, { exclude: true })).toEqual(await render(bare, { exclude: true }))
  })

  it('is needed: with the mixin alone, a built-in wrapper deepens every id under it', async () => {
    expect(await render(wrappers.Transition, { exclude: false })).not.toEqual(await render(bare, { exclude: false }))
  })
})
