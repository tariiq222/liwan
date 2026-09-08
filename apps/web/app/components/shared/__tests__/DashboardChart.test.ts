import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed } from 'vue'
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
