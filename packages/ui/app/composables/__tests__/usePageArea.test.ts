import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { providePageArea, usePageArea, type PageAreaClassifier } from '../usePageArea'

async function classify(path: string, provided?: PageAreaClassifier) {
  let result: ReturnType<PageAreaClassifier> | undefined
  const Child = defineComponent({ setup() { result = usePageArea()(path); return () => h('i') } })
  const Root = defineComponent({ setup() { if (provided) providePageArea(provided); return () => h(Child) } })
  await renderToString(createSSRApp(Root))
  return result
}

describe('usePageArea', () => {
  it('classifies every path as a neutral workspace page until the app provides a classifier', async () => {
    expect(await classify('/login')).toEqual({ plain: false, record: false })
  })

  it('uses the classifier the app provides', async () => {
    const provided: PageAreaClassifier = path => ({ plain: path === '/login', record: path === '/a/1' })
    expect(await classify('/login', provided)).toEqual({ plain: true, record: false })
    expect(await classify('/a/1', provided)).toEqual({ plain: false, record: true })
  })
})
