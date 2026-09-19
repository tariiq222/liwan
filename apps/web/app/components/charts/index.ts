import type { Component } from "vue"

export { default as ChartContainer } from "./ChartContainer.vue"
export { default as ChartLegendContent } from "./ChartLegendContent.vue"
export { default as ChartTooltipContent } from "./ChartTooltipContent.vue"
export { componentToString } from "./utils"

export type ChartConfig = {
  [k in string]: {
    label?: string | Component
    color?: string
  }
}
