import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../DashboardChart.client.vue')
const script = parse(readFileSync(filename, 'utf8'), { filename }).descriptor.scriptSetup!.content

function loadProductionBarTooltip() {
  const ast = ts.createSourceFile('DashboardChart.ts', script, ts.ScriptTarget.Latest, true)
  const declaration = ast.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'barTooltip',
  )
  if (!declaration) throw new Error('DashboardChart barTooltip was not found')

  const barTooltipSource = declaration.getText(ast)
  const code = ts.transpileModule(`
    const bars = computed(() => chart)
    function tooltipContent(_label, payload) { return payload }
    ${barTooltipSource}
  `, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText

  return new Function('computed', 'chart', `${code}; return barTooltip`)(computed, {
    kind: 'bar',
    series: [{ key: 'progress', label: '' }],
  }) as (raw: unknown) => Record<string, unknown> | undefined
}

// Vue probes `then` to detect a promise and `__isScriptSetup` to decide
// whether bindings may reach _ctx; answering either would hide the template.
const INTERNAL_PROBES = new Set(['then', 'catch', 'finally'])
const internal = (key: string) => INTERNAL_PROBES.has(key) || key.startsWith('__')

describe('DashboardChart donut path drawing', () => {
  it('commits donut geometry immediately instead of tweening its arc paths', async () => {
    // The arcs are drawn by Unovis, not by this repo, so the contract that can
    // be held here is the one this component passes it: a tweened arc path
    // interpolates the SVG large-arc and sweep flags off 0/1 and tears the ring.
    const parsed = parse(readFileSync(filename, 'utf8'), { filename })
    const compiled = compileTemplate({
      source: parsed.descriptor.template!.content, filename, id: 'dashboard-chart-donut',
      compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
    })
    if (compiled.errors.length) throw compiled.errors[0]
    const code = ts.transpileModule(compiled.code, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    }).outputText
    const render = new Function('Vue', code)(Vue) as () => unknown
    const app = createSSRApp({
      render: () => h(defineComponent({
        // Only the donut branch is under test; anything else the template
        // reaches for answers harmlessly rather than being listed by hand.
        setup: () => new Proxy({
          donut: { data: [{ name: 'أ', value: 1 }] }, donutData: [{ name: 'أ', value: 1 }],
          donutColors: ['#06c'], donutPlotHeight: 200, motionEpoch: 0, chartConfig: {},
          fontSize: 'medium', height: '240px', accessibleLabel: 'donut',
          donutTooltipTriggers: {}, bars: null, chart: { kind: 'donut' },
        } as Record<string | symbol, unknown>, {
          has: (target, key) => key in target || (typeof key === 'string' && !internal(key)),
          // Vue asks hasOwnProperty, not `in`, before exposing a binding.
          getOwnPropertyDescriptor: (target, key) => (
            key in target
              ? Reflect.getOwnPropertyDescriptor(target, key)
              : typeof key === 'string' && !internal(key)
                ? { configurable: true, enumerable: true, value: () => '' }
                : undefined
          ),
          get: (target, key) => {
            if (key in target) return target[key]
            if (typeof key === 'symbol' || internal(key as string)) return undefined
            return () => ''
          },
        }),
        render,
      })),
    })
    for (const match of code.matchAll(/_resolveComponent\("([^"]+)"\)/g)) {
    const name = match[1]!
      app.component(name, defineComponent({
        inheritAttrs: false,
        setup: (_, { slots, attrs }) => () => h('div', attrs, slots.default?.()),
      }))
    }
    const html = await renderToString(app)
    expect(html).toContain('data-testid="chart-canvas"')
    // Both the container and the donut itself are told not to animate; a single
    // survivor is enough to tween the ring back into torn arcs.
    const durations = [...html.matchAll(/duration="([^"]*)"/g)].map(match => match[1]!)
    expect(durations).toEqual(['0', '0'])
  })
})

describe('DashboardChart production tooltip behavior', () => {
  it('keeps display formatting for measured values such as tracked progress percentages', () => {
    const barTooltip = loadProductionBarTooltip()

    expect(barTooltip({
      data: {
        name: 'Project 1',
        values: { progress: 50 },
        displayValues: { progress: '50%' },
      },
    })).toEqual({ progress: '50%' })
  })

  it('keeps semantic unavailable values and raw numeric values when no display value exists', () => {
    const barTooltip = loadProductionBarTooltip()

    expect(barTooltip({
      data: {
        name: 'Project without tasks',
        values: { progress: null },
        stateLabel: 'No tasks',
      },
    })).toEqual({ progress: 'No tasks' })
    expect(barTooltip({
      data: {
        name: 'Project 2',
        values: { progress: 7 },
      },
    })).toEqual({ progress: 7 })
  })
})
